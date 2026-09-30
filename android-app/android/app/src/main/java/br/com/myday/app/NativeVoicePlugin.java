package br.com.myday.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Ponte JS ↔ gravador nativo: start(), level(), stop(), cancel(). */
@CapacitorPlugin(
        name = "NativeVoice",
        permissions = {@Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone")})
public class NativeVoicePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStart(call);
        } else {
            call.reject("PERMISSION_DENIED");
        }
    }

    private void doStart(PluginCall call) {
        if (RecorderService.isRecording()) {
            call.resolve();
            return;
        }
        Context ctx = getContext();
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, RecorderService.class));
        } catch (Exception e) {
            call.reject("START_FAILED: " + e.getMessage());
            return;
        }
        // O serviço grava em outra thread; espera (até ~3 s) confirmar que começou.
        for (int i = 0; i < 60; i++) {
            if (RecorderService.isRecording()) {
                call.resolve();
                return;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException ignored) {
                break;
            }
        }
        call.reject("START_FAILED");
    }

    @PluginMethod
    public void level(PluginCall call) {
        JSObject out = new JSObject();
        out.put("level", RecorderService.level());
        out.put("recording", RecorderService.isRecording());
        call.resolve(out);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            RecorderService.Result r = RecorderService.stop();
            if (r == null || r.bytes.length == 0) {
                call.reject("EMPTY");
                return;
            }
            JSObject out = new JSObject();
            out.put("base64", Base64.encodeToString(r.bytes, Base64.NO_WRAP));
            out.put("mimeType", "audio/aac");
            out.put("seconds", r.millis / 1000.0);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("STOP_FAILED: " + e.getMessage());
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        RecorderService.cancel();
        call.resolve();
    }
}
