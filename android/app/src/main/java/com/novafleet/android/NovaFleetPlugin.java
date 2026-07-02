package com.novafleet.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "NovaFleet",
    permissions = {
        @Permission(alias = "localNetwork", strings = { "android.permission.ACCESS_LOCAL_NETWORK" })
    }
)
public class NovaFleetPlugin extends Plugin {
    private static final String PREFS = "nova_fleet";
    private static final String PRINTERS = "printers";
    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, JSObject> metadataCache = new ConcurrentHashMap<>();
    private SharedPreferences preferences;

    @Override
    public void load() {
        preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!preferences.contains(PRINTERS)) writePrinters(starterPrinters());
    }

    @PluginMethod
    public void requestLocalNetworkPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 37 || getPermissionState("localNetwork") == PermissionState.GRANTED) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        requestPermissionForAlias("localNetwork", call, "localNetworkPermissionCallback");
    }

    @PermissionCallback
    private void localNetworkPermissionCallback(PluginCall call) {
        boolean granted = getPermissionState("localNetwork") == PermissionState.GRANTED;
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void listPrinters(PluginCall call) {
        async(call, () -> new JSObject().put("printers", readPrinters()));
    }

    @PluginMethod
    public void savePrinter(PluginCall call) {
        async(call, () -> {
            JSONArray printers = readPrinters();
            String rawHost = value(call.getString("host"), "").trim().replaceFirst("^https?://", "");
            rawHost = rawHost.replaceFirst("/.*$", "");
            int port = value(call.getInt("port"), 8081);
            int colon = rawHost.lastIndexOf(':');
            if (colon > 0 && rawHost.substring(colon + 1).matches("\\d+")) {
                port = Integer.parseInt(rawHost.substring(colon + 1));
                rawHost = rawHost.substring(0, colon);
            }
            if (rawHost.trim().isEmpty()) throw new IOException("Geçerli bir IP adresi veya sunucu adı girin.");

            String id = value(call.getString("id"), UUID.randomUUID().toString());
            JSObject printer = new JSObject()
                .put("id", id)
                .put("name", value(call.getString("name"), "İsimsiz yazıcı").trim())
                .put("host", rawHost)
                .put("port", port)
                .put("model", value(call.getString("model"), "Nova3D Bene4"))
                .put("location", value(call.getString("location"), ""))
                .put("pollInterval", Math.max(5, value(call.getInt("pollInterval"), 10)))
                .put("enabled", value(call.getBoolean("enabled"), true));

            int index = indexOf(printers, id);
            if (index >= 0) printers.put(index, printer); else printers.put(printer);
            writePrinters(printers);
            metadataCache.remove(id);
            return new JSObject().put("printer", printer);
        });
    }

    @PluginMethod
    public void removePrinter(PluginCall call) {
        async(call, () -> {
            String id = required(call, "id");
            JSONArray current = readPrinters();
            JSONArray next = new JSONArray();
            for (int i = 0; i < current.length(); i++) {
                JSONObject printer = current.getJSONObject(i);
                if (!id.equals(printer.optString("id"))) next.put(printer);
            }
            writePrinters(next);
            metadataCache.remove(id);
            return ok("Yazıcı filodan kaldırıldı.");
        });
    }

    @PluginMethod
    public void refreshPrinter(PluginCall call) {
        async(call, () -> new JSObject().put("snapshot", snapshot(findPrinter(required(call, "id")))));
    }

    @PluginMethod
    public void refreshAll(PluginCall call) {
        async(call, () -> {
            JSONArray snapshots = new JSONArray();
            JSONArray printers = readPrinters();
            for (int i = 0; i < printers.length(); i++) {
                JSONObject printer = printers.getJSONObject(i);
                if (printer.optBoolean("enabled", true)) snapshots.put(snapshot(printer));
            }
            return new JSObject().put("snapshots", snapshots);
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        command(call, "/file/delete/" + Uri.encode(required(call, "fileName")), "Dosya silindi.");
    }

    @PluginMethod
    public void printFile(PluginCall call) {
        command(call, "/file/print/" + Uri.encode(required(call, "fileName")), "Yazdırma işi başlatıldı.");
    }

    @PluginMethod
    public void controlJob(PluginCall call) {
        String action = value(call.getString("action"), "toggle");
        if (!action.equals("toggle") && !action.equals("stop")) {
            call.reject("Geçersiz yazdırma komutu.");
            return;
        }
        command(call, "/job/" + action + "/" + Uri.encode(required(call, "jobId")), action.equals("stop") ? "Yazdırma durduruldu." : "Yazdırma durumu değiştirildi.");
    }

    @PluginMethod
    public void chooseAndUpload(PluginCall call) {
        try { findPrinter(required(call, "id")); }
        catch (Exception error) { call.reject(error.getMessage()); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/octet-stream", "application/zip", "*/*" });
        startActivityForResult(call, intent, "fileChosen");
    }

    @ActivityCallback
    private void fileChosen(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("ok", false).put("message", "Dosya seçilmedi."));
            return;
        }
        Uri uri = result.getData().getData();
        executor.execute(() -> {
            try {
                JSONObject printer = findPrinter(required(call, "id"));
                upload(printer, uri);
                call.resolve(ok("Dosya yazıcıya yüklendi."));
            } catch (Exception error) {
                call.resolve(failed(error));
            }
        });
    }

    private void command(PluginCall call, String path, String message) {
        async(call, () -> {
            JSONObject printer = findPrinter(required(call, "id"));
            if (!printer.optString("host").startsWith("demo-")) request(printer, path, 10000);
            return ok(message);
        });
    }

    private JSObject snapshot(JSONObject source) throws Exception {
        JSObject config = new JSObject(source.toString());
        String host = source.optString("host");
        if (host.startsWith("demo-")) return demoSnapshot(config);
        long started = System.currentTimeMillis();
        try {
            JSONArray rawFiles = new JSONArray(request(source, "/file/list", 7000));
            JSONArray files = new JSONArray();
            long usedBytes = 0;
            for (int i = 0; i < rawFiles.length(); i++) {
                JSONObject raw = rawFiles.getJSONObject(i);
                String name = raw.optString("name");
                String extension = raw.optString("extension").replaceFirst("^\\.", "");
                String fullName = extension.isEmpty() || name.toLowerCase().endsWith("." + extension.toLowerCase()) ? name : name + "." + extension;
                long size = raw.optLong("size", 0);
                usedBytes += size;
                files.put(new JSObject().put("name", name).put("extension", extension).put("size", size).put("modifiedDate", raw.optString("modifiedDate")).put("fullName", fullName));
            }

            JSONArray jobs = new JSONArray();
            String jobError = null;
            try { jobs = new JSONArray(request(source, "/job/list/", 4500)); }
            catch (Exception error) { jobError = error.getMessage(); }

            JSObject activeJob = null;
            JSONArray recentJobs = new JSONArray();
            for (int i = 0; i < jobs.length(); i++) {
                JSObject job = normalizeJob(jobs.getJSONObject(i));
                if (activeJob == null && (job.getBoolean("printInProgress", false) || job.getBoolean("printPaused", false))) activeJob = job;
                else if (recentJobs.length() < 20) recentJobs.put(job);
            }

            JSObject metadata = metadataCache.get(source.optString("id"));
            if (metadata == null) {
                metadata = new JSObject();
                try { metadata.put("firmware", request(source, "/setting/currentVersion", 3500).trim()); } catch (Exception ignored) {}
                try { metadata.put("model", request(source, "/setting/printerInfo", 3500).trim()); } catch (Exception ignored) {}
                metadataCache.put(source.optString("id"), metadata);
            }
            String model = metadata.getString("model", null);
            if (model != null && !model.trim().isEmpty()) config.put("model", model);
            String state = activeJob != null && activeJob.getBoolean("printPaused", false) ? "paused" : activeJob != null && activeJob.getBoolean("printInProgress", false) ? "printing" : "online";
            JSObject result = new JSObject()
                .put("config", config).put("state", state).put("latency", System.currentTimeMillis() - started)
                .put("files", files).put("usedBytes", usedBytes).put("lastSeen", nowIso());
            String firmware = metadata.getString("firmware", null);
            if (firmware != null && !firmware.trim().isEmpty()) result.put("firmware", firmware);
            if (activeJob != null) result.put("activeJob", activeJob);
            result.put("recentJobs", recentJobs);
            if (jobError != null) result.put("error", jobError);
            return result;
        } catch (Exception error) {
            return new JSObject().put("config", config).put("state", "offline").put("files", new JSONArray()).put("usedBytes", 0).put("error", message(error));
        }
    }

    private JSObject normalizeJob(JSONObject raw) {
        int total = raw.optInt("totalSlices", 0);
        int current = raw.optInt("currentSlice", 0);
        return new JSObject()
            .put("id", first(raw, "id", "uuid", "jobId"))
            .put("jobName", firstOr(raw, "İsimsiz iş", "jobName", "fileName", "name"))
            .put("printInProgress", firstBoolean(raw, "printInProgress", "printing", "active"))
            .put("printPaused", firstBoolean(raw, "printPaused", "paused"))
            .put("status", raw.optString("status"))
            .put("thickness", raw.optDouble("thickness", 0))
            .put("totalSlices", total).put("currentSlice", current)
            .put("currentSliceTime", raw.optLong("currentSliceTime", 0))
            .put("averageSliceTime", raw.optLong("averageSliceTime", 0))
            .put("elapsedTime", raw.optLong("elapsedTime", 0))
            .put("beginPrintTime", raw.optLong("beginPrintTime", 0))
            .put("endPrintTime", raw.optLong("endPrintTime", 0))
            .put("layerTime", raw.optLong("layerTime", 0))
            .put("bottomLayersTime", raw.optLong("bottomLayersTime", 0))
            .put("numberOfBottomLayers", raw.optInt("numberOfBottomLayers", 0))
            .put("resinUsage", raw.optDouble("resinUsage", 0))
            .put("totalCost", raw.optDouble("totalCost", 0))
            .put("totalExposureTime", raw.optDouble("totalExposureTime", 0))
            .put("zliftDistance", raw.optDouble("zliftDistance", 0))
            .put("zliftSpeed", raw.optDouble("zliftSpeed", 0))
            .put("errorDescription", raw.optString("errorDescription", ""))
            .put("progress", total > 0 ? Math.min(100d, (current * 100d) / total) : 0d);
    }

    private void upload(JSONObject printer, Uri uri) throws Exception {
        String fileName = displayName(uri);
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".cws")) throw new IOException("Yalnızca .cws dosyaları yüklenebilir.");
        long size = fileSize(uri);
        HttpURLConnection connection = open(printer, "/file/upload/" + Uri.encode(fileName), 120000);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/octet-stream");
        if (size >= 0) connection.setFixedLengthStreamingMode(size); else connection.setChunkedStreamingMode(64 * 1024);
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); OutputStream output = connection.getOutputStream()) {
            if (input == null) throw new IOException("Seçilen dosya açılamadı.");
            byte[] buffer = new byte[64 * 1024];
            long uploaded = 0;
            int lastPercent = -1;
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                uploaded += read;
                int percent = size > 0 ? (int) Math.min(100, uploaded * 100 / size) : 0;
                if (percent != lastPercent) {
                    lastPercent = percent;
                    notifyListeners("uploadProgress", new JSObject().put("printerId", printer.optString("id")).put("fileName", fileName).put("percent", percent));
                }
            }
        }
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) throw new IOException("Yükleme HTTP " + code + " ile reddedildi.");
        notifyListeners("uploadProgress", new JSObject().put("printerId", printer.optString("id")).put("fileName", fileName).put("percent", 100));
        connection.disconnect();
    }

    private String request(JSONObject printer, String path, int timeout) throws IOException {
        HttpURLConnection connection = open(printer, path, timeout);
        connection.setRequestMethod("GET");
        int code = connection.getResponseCode();
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        String body = stream == null ? "" : readText(stream);
        connection.disconnect();
        if (code < 200 || code >= 300) throw new IOException("Yazıcı HTTP " + code + ": " + body);
        return body;
    }

    private HttpURLConnection open(JSONObject printer, String path, int timeout) throws IOException {
        int port = printer.optInt("port", 8081);
        HttpURLConnection connection = (HttpURLConnection) new URL("http://" + printer.optString("host") + ":" + port + path).openConnection();
        connection.setConnectTimeout(timeout);
        connection.setReadTimeout(timeout);
        connection.setUseCaches(false);
        return connection;
    }

    private JSONObject findPrinter(String id) throws Exception {
        JSONArray printers = readPrinters();
        int index = indexOf(printers, id);
        if (index < 0) throw new IOException("Yazıcı bulunamadı.");
        return printers.getJSONObject(index);
    }

    private int indexOf(JSONArray printers, String id) {
        for (int i = 0; i < printers.length(); i++) if (id.equals(printers.optJSONObject(i).optString("id"))) return i;
        return -1;
    }

    private JSONArray readPrinters() {
        try { return new JSONArray(preferences.getString(PRINTERS, "[]")); }
        catch (JSONException ignored) { return new JSONArray(); }
    }

    private void writePrinters(JSONArray printers) { preferences.edit().putString(PRINTERS, printers.toString()).apply(); }

    private JSONArray starterPrinters() {
        JSONArray printers = new JSONArray();
        printers.put(config("demo-lab-01", "Reçine Lab 01", "demo-1", "Nova3D Elfin", "Prototip Atölyesi", 10));
        printers.put(config("demo-lab-02", "Reçine Lab 02", "demo-2", "Nova3D Bene4", "Prototip Atölyesi", 12));
        printers.put(config("demo-studio", "Tasarım Stüdyosu", "demo-3", "Nova3D Whale3", "2. Kat", 15));
        return printers;
    }

    private JSObject config(String id, String name, String host, String model, String location, int poll) {
        return new JSObject().put("id", id).put("name", name).put("host", host).put("port", 8081).put("model", model).put("location", location).put("pollInterval", poll).put("enabled", true);
    }

    private JSObject demoSnapshot(JSObject config) {
        String host = config.getString("host", "");
        if (host.equals("demo-3")) return new JSObject().put("config", config).put("state", "offline").put("files", new JSONArray()).put("usedBytes", 0).put("error", "Yazıcı ağda yanıt vermiyor.");
        JSONArray files = new JSONArray();
        files.put(new JSObject().put("name", "gearbox_v12").put("extension", "cws").put("size", 48890112).put("modifiedDate", "2026-06-30 09:42").put("fullName", "gearbox_v12.cws"));
        JSObject result = new JSObject().put("config", config).put("state", host.equals("demo-1") ? "printing" : "online").put("latency", 20).put("firmware", "3.5.0").put("files", files).put("usedBytes", 48890112).put("lastSeen", nowIso());
        if (host.equals("demo-1")) result.put("activeJob", new JSObject().put("id", "demo-job").put("jobName", "gearbox_v12.cws").put("printInProgress", true).put("printPaused", false).put("status", "printing").put("thickness", .05).put("totalSlices", 1842).put("currentSlice", 1065).put("currentSliceTime", 14000).put("averageSliceTime", 14200).put("elapsedTime", 3112000).put("progress", 57.8));
        return result;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        }
        return value(uri.getLastPathSegment(), "upload.cws");
    }

    private long fileSize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        }
        return -1;
    }

    private String readText(InputStream stream) throws IOException {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private String required(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException(key + " gerekli.");
        return value;
    }

    private String first(JSONObject object, String... keys) { return firstOr(object, "", keys); }
    private String firstOr(JSONObject object, String fallback, String... keys) {
        for (String key : keys) { String value = object.optString(key, ""); if (!value.trim().isEmpty()) return value; }
        return fallback;
    }
    private String nowIso() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }
    private boolean firstBoolean(JSONObject object, String... keys) {
        for (String key : keys) if (object.has(key)) return object.optBoolean(key, false);
        return false;
    }
    private <T> T value(T value, T fallback) { return value == null ? fallback : value; }
    private JSObject ok(String message) { return new JSObject().put("ok", true).put("message", message); }
    private JSObject failed(Exception error) { return new JSObject().put("ok", false).put("message", message(error)); }
    private String message(Exception error) { return error.getMessage() == null ? "Beklenmeyen bir hata oluştu." : error.getMessage(); }

    private interface Task { JSObject run() throws Exception; }
    private void async(PluginCall call, Task task) {
        executor.execute(() -> {
            try { call.resolve(task.run()); }
            catch (Exception error) { call.reject(message(error)); }
        });
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
