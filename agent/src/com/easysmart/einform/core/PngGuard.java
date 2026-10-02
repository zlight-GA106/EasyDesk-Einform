package com.easysmart.einform.core;

import java.io.DataInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.zip.CRC32;

/** Reject partial PNGs (BitmapFactory may otherwise accept a truncated image). */
public final class PngGuard {
    public static final int MAX_BYTES = 8 * 1024 * 1024;
    public static void validate(File file) throws IOException {
        if (file.length() < 57 || file.length() > MAX_BYTES) throw new IOException("PNG size outside limit");
        DataInputStream in = new DataInputStream(new FileInputStream(file));
        try {
            if (in.readLong() != 0x89504e470d0a1a0aL) throw new IOException("Invalid PNG signature");
            boolean header = false, data = false;
            byte[] buffer = new byte[8192];
            long remaining = file.length() - 8;
            while (remaining >= 12) {
                int length = in.readInt();
                int type = in.readInt();
                remaining -= 12;
                if (length < 0 || length > remaining) throw new IOException("Truncated PNG chunk");
                if (!header && (type != 0x49484452 || length != 13)) throw new IOException("Missing PNG header");
                CRC32 crc = new CRC32();
                crc.update(type >>> 24); crc.update(type >>> 16); crc.update(type >>> 8); crc.update(type);
                int left = length;
                while (left > 0) {
                    int count = Math.min(left, buffer.length);
                    in.readFully(buffer, 0, count); crc.update(buffer, 0, count);
                    if (!header) {
                        int width = integer(buffer, 0), height = integer(buffer, 4);
                        if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long)width * height > 16777216L)
                            throw new IOException("PNG dimensions outside limit");
                        header = true;
                    }
                    left -= count;
                }
                if ((in.readInt() & 0xffffffffL) != crc.getValue()) throw new IOException("PNG checksum mismatch");
                remaining -= length;
                if (type == 0x49444154) data = true;
                if (type == 0x49454e44) {
                    if (!data || length != 0 || remaining != 0) throw new IOException("Invalid PNG end");
                    return;
                }
            }
            throw new IOException("Missing PNG end");
        } finally { in.close(); }
    }
    private static int integer(byte[] b, int offset) {
        return (b[offset] & 255) << 24 | (b[offset+1] & 255) << 16 | (b[offset+2] & 255) << 8 | b[offset+3] & 255;
    }
    private PngGuard() {}
}
