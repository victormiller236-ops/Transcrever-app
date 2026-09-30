package br.com.myday.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Guarda os lembretes no aparelho e os agenda no AlarmManager. Assim eles disparam
 * com o app fechado, a tela apagada e mesmo depois de reiniciar o celular.
 */
final class ReminderScheduler {
    private static final String PREFS = "myday_lembretes";
    private static final String KEY_ITEMS = "items";
    static final String EXTRA_ID = "id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";
    static final String EXTRA_SPOKEN = "spoken";

    private ReminderScheduler() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray load(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(KEY_ITEMS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static PendingIntent pendingFor(Context ctx, JSONObject item, int flags) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.setAction("br.com.myday.app.LEMBRETE");
        i.putExtra(EXTRA_ID, item.optString("id"));
        i.putExtra(EXTRA_TITLE, item.optString("title"));
        i.putExtra(EXTRA_BODY, item.optString("body"));
        i.putExtra(EXTRA_SPOKEN, item.optString("spoken"));
        return PendingIntent.getBroadcast(ctx, item.optString("id").hashCode(), i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canScheduleExact(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        return am != null && am.canScheduleExactAlarms();
    }

    private static void cancelAlarms(Context ctx, JSONArray items) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            am.cancel(pendingFor(ctx, item, PendingIntent.FLAG_UPDATE_CURRENT));
        }
    }

    private static void setAlarm(Context ctx, JSONObject item) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        long at = item.optLong("at");
        PendingIntent pi = pendingFor(ctx, item, PendingIntent.FLAG_UPDATE_CURRENT);
        if (canScheduleExact(ctx)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    /** Troca a agenda inteira: cancela o que havia e agenda só os itens futuros recebidos. */
    static int replaceAll(Context ctx, JSONArray incoming) {
        cancelAlarms(ctx, load(ctx));
        long now = System.currentTimeMillis();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < incoming.length(); i++) {
            JSONObject item = incoming.optJSONObject(i);
            if (item == null || item.optString("id").isEmpty() || item.optLong("at") <= now) continue;
            kept.put(item);
            setAlarm(ctx, item);
        }
        prefs(ctx).edit().putString(KEY_ITEMS, kept.toString()).apply();
        return kept.length();
    }

    /** Depois de reiniciar o aparelho os alarmes somem; reagenda os que ainda valem. */
    static void restore(Context ctx) {
        long now = System.currentTimeMillis();
        JSONArray items = load(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || item.optLong("at") <= now) continue;
            kept.put(item);
            setAlarm(ctx, item);
        }
        prefs(ctx).edit().putString(KEY_ITEMS, kept.toString()).apply();
    }

    /** Um lembrete disparou: tira da lista. */
    static void consumed(Context ctx, String id) {
        JSONArray items = load(ctx);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) kept.put(item);
        }
        prefs(ctx).edit().putString(KEY_ITEMS, kept.toString()).apply();
    }
}
