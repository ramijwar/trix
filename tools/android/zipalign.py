#!/usr/bin/env python3
"""
zipalign مصغّر: يعيد كتابة ملف APK مع محاذاة 4 بايت للمدخلات غير المضغوطة
- resources.arsc يُخزَّن بدون ضغط (شرط أندرويد 11+)
- يحافظ على كل المدخلات الأخرى كما هي (مضغوطة)
الاستخدام: python3 zipalign.py in.apk out.apk [alignment]
"""
import sys
import struct
import zlib
import zipfile

ALIGN_STORE = {b"resources.arsc"}
STORE_EXTS = ()  # نترك الباقي كما هو


def main() -> int:
    src, dst = sys.argv[1], sys.argv[2]
    align = int(sys.argv[3]) if len(sys.argv) > 3 else 4

    zin = zipfile.ZipFile(src, "r")
    entries = []
    for info in zin.infolist():
        if info.is_dir():
            continue
        data = zin.read(info.filename)
        name = info.filename.encode("utf-8")
        force_store = name in ALIGN_STORE
        method = 0 if (info.compress_type == zipfile.ZIP_STORED or force_store) else 8
        entries.append(
            {
                "name": name,
                "data": data,
                "method": method,
                "crc": zlib.crc32(data) & 0xFFFFFFFF,
                "date_time": info.date_time,
                "external_attr": info.external_attr,
                "compress_type": info.compress_type,
            }
        )
    zin.close()

    def dos_time(dt):
        year, month, day, hour, minute, second = dt
        if year < 1980:
            year = 1980
        return ((hour << 11) | (minute << 5) | (second // 2), ((year - 1980) << 9) | (month << 5) | day)

    out = open(dst, "wb")
    central = []
    try:
        for e in entries:
            t, d = dos_time(e["date_time"])
            if e["method"] == 8:
                body = zlib.compressobj(9, zlib.DEFLATED, -15)
                payload = body.compress(e["data"]) + body.flush()
            else:
                payload = e["data"]
            offset = out.tell()
            name_len = len(e["name"])
            # نحسب طول حقل extra المطلوب لمحاذاة بداية البيانات
            base = offset + 30 + name_len
            pad = 0
            if e["method"] == 0:
                pad = (align - (base % align)) % align
                if pad and pad < 4:
                    pad += align
            extra = b""
            if pad:
                extra = struct.pack("<HH", 0xBEEF, pad - 4) + b"\x00" * (pad - 4) if pad >= 4 else b"\x00" * pad
                if len(extra) != pad:
                    extra = b"\x00" * pad
            flags = 0x0800  # أسماء بترميز UTF-8
            header = struct.pack(
                "<IHHHHHIIIHH",
                0x04034B50,
                20,
                flags,
                e["method"],
                t,
                d,
                e["crc"],
                len(payload),
                len(e["data"]),
                name_len,
                len(extra),
            )
            out.write(header)
            out.write(e["name"])
            out.write(extra)
            out.write(payload)
            central.append((e, offset, len(payload), len(extra), t, d))

        cd_start = out.tell()
        for e, offset, csize, extra_len, t, d in central:
            out.write(
                struct.pack(
                    "<IHHHHHHIIIHHHHHII",
                    0x02014B50,
                    20,
                    20,
                    0x0800,
                    e["method"],
                    t,
                    d,
                    e["crc"],
                    csize,
                    len(e["data"]),
                    len(e["name"]),
                    extra_len,
                    0,
                    0,
                    0,
                    e["external_attr"],
                    offset & 0xFFFFFFFF,
                )
            )
            out.write(e["name"])
            if extra_len:
                out.write(b"\x00" * extra_len)
        cd_size = out.tell() - cd_start
        out.write(
            struct.pack(
                "<IHHHHIIH",
                0x06054B50,
                0,
                0,
                len(central),
                len(central),
                cd_size,
                cd_start,
                0,
            )
        )
    finally:
        out.close()
    print(f"zipalign: {len(entries)} entry -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
