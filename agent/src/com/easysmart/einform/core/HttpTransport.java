package com.easysmart.einform.core;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public final class HttpTransport {
    public static final class HttpError extends IOException {
        public final int code;
        HttpError(int code, String path) { super("HTTP " + code + " " + path); this.code = code; }
    }
    public static final class ImageResponse {
        public final boolean unchanged;
        public final String etag, revision;
        ImageResponse(boolean unchanged, String etag, String revision) { this.unchanged = unchanged; this.etag = etag; this.revision = revision; }
    }
    private final String base;
    private volatile HttpURLConnection active;
    public HttpTransport(String base) { this.base = base; }
    private HttpURLConnection open(String path) throws IOException {
        // API URLs are same-server absolute paths, never arbitrary redirects or external URLs.
        if (!path.startsWith("/api/") || path.startsWith("//") || path.indexOf('\r') >= 0 || path.indexOf('\n') >= 0)
            throw new IOException("Invalid API path");
        HttpURLConnection connection = (HttpURLConnection)new URL(base + path).openConnection();
        active = connection;
        connection.setConnectTimeout(7000); connection.setReadTimeout(12000);
        connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
        return connection;
    }
    public String json(String path, String body) throws IOException {
        return json(path, body, 12000);
    }
    public String json(String path, String body, int readTimeout) throws IOException {
        HttpURLConnection connection = open(path);
        connection.setReadTimeout(readTimeout);
        try {
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                byte[] bytes = body.getBytes("UTF-8");
                connection.setRequestMethod("POST"); connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(bytes.length);
                OutputStream output = connection.getOutputStream();
                try { output.write(bytes); } finally { output.close(); }
            }
            int code = connection.getResponseCode();
            if (code != 200) throw new HttpError(code, path);
            InputStream input = connection.getInputStream();
            try {
                ByteArrayOutputStream bytes = new ByteArrayOutputStream(); copy(input, bytes, 128 * 1024);
                return new String(bytes.toByteArray(), "UTF-8");
            } finally { input.close(); }
        } finally { close(connection); }
    }
    public ImageResponse image(String path, String etag, File temporary) throws IOException {
        HttpURLConnection connection = open(path);
        try {
            connection.setRequestProperty("Accept", "image/png");
            if (etag.length() > 0) connection.setRequestProperty("If-None-Match", etag);
            int code = connection.getResponseCode();
            if (code == 304) return new ImageResponse(true, etag, value(connection.getHeaderField("X-EasyDesk-Revision")));
            if (code != 200) throw new HttpError(code, path);
            String type = value(connection.getContentType()).toLowerCase(java.util.Locale.US);
            if (!type.startsWith("image/png")) throw new IOException("Expected image/png");
            int expected = connection.getContentLength();
            if (expected > PngGuard.MAX_BYTES) throw new IOException("PNG too large");
            InputStream input = connection.getInputStream();
            FileOutputStream output = new FileOutputStream(temporary);
            try { copy(input, output, PngGuard.MAX_BYTES); output.getFD().sync(); }
            finally { try { input.close(); } finally { output.close(); } }
            if (expected >= 0 && temporary.length() != expected) throw new IOException("Incomplete PNG response");
            PngGuard.validate(temporary);
            return new ImageResponse(false, value(connection.getHeaderField("ETag")), value(connection.getHeaderField("X-EasyDesk-Revision")));
        } finally { close(connection); }
    }
    private void close(HttpURLConnection connection) { connection.disconnect(); if (active == connection) active = null; }
    public void cancel() { HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    private static void copy(InputStream input, OutputStream output, int limit) throws IOException {
        byte[] buffer = new byte[8192]; int count, total = 0;
        while ((count = input.read(buffer)) != -1) {
            total += count; if (total > limit) throw new IOException("Response too large");
            output.write(buffer, 0, count);
        }
    }
    private static String value(String value) { return value == null ? "" : value; }
}
