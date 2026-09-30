package br.com.myday.app;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Ponte JS ↔ agenda de lembretes do aparelho (alarmes que falam com o app fechado). */
@CapacitorPlugin(
        name = "NativeReminders",
        permissions = {@Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")})
public class NativeRemindersPlugin extends Plugin {

    /** Substitui toda a agenda pelos lembretes recebidos: [{id, at, title, body, spoken}]. */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray items = call.getArray("items");
        JSONArray list = items != null ? items : new JSONArray();
        int scheduled = ReminderScheduler.replaceAll(getContext(), list);
        call.resolve(buildStatus(scheduled));
    }

    /** Dispara um lembrete de teste daqui a alguns segundos. */
    @PluginMethod
    public void testNow(PluginCall call) {
        int seconds = Math.max(1, Math.min(60, call.getInt("seconds", 5)));
        try {
            JSONObject item = new JSONObject();
            item.put("id", "teste");
            item.put("at", System.currentTimeMillis() + seconds * 1000L);
            item.put("title", call.getString("title", "Teste do MyDay"));
            item.put("body", "Agora");
            item.put("spoken", call.getString("spoken", "Lembrete: teste do MyDay. É agora."));
            // Junta ao que já estava agendado, sem apagar os lembretes reais.
            JSONArray all = ReminderScheduler.load(getContext());
            all.put(item);
            ReminderScheduler.replaceAll(getContext(), all);
        } catch (JSONException e) {
            call.reject("INVALID");
            return;
        }
        call.resolve(buildStatus(-1));
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(buildStatus(-1));
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(buildStatus(-1));
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        call.resolve(buildStatus(-1));
    }

    private JSObject buildStatus(int scheduled) {
        Context ctx = getContext();
        JSObject out = new JSObject();
        out.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        out.put("exactAlarms", ReminderScheduler.canScheduleExact(ctx));
        if (scheduled >= 0) out.put("scheduled", scheduled);
        else out.put("scheduled", ReminderScheduler.load(ctx).length());
        return out;
    }
}
