package br.com.myday.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/** Canais de notificação e atalhos comuns aos serviços. */
final class Notifications {
    static final String CHANNEL_REMINDERS = "myday_lembretes";
    static final String CHANNEL_RECORDING = "myday_gravacao";

    private Notifications() {}

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        if (nm.getNotificationChannel(CHANNEL_REMINDERS) == null) {
            NotificationChannel ch =
                    new NotificationChannel(CHANNEL_REMINDERS, "Lembretes", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Avisos das suas tarefas, com som e leitura em voz alta");
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] {0, 400, 200, 400, 200, 800});
            Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes attrs =
                    new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
            ch.setSound(sound, attrs);
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_RECORDING) == null) {
            NotificationChannel ch =
                    new NotificationChannel(CHANNEL_RECORDING, "Gravação", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Aparece enquanto o MyDay grava sua voz");
            nm.createNotificationChannel(ch);
        }
    }

    /** Toque na notificação abre o app. */
    static PendingIntent openApp(Context ctx) {
        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) launch = new Intent();
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
