package br.com.myday.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.util.Locale;

/**
 * Toca o aviso (som + vibração pelo canal da notificação) e lê o lembrete em voz alta,
 * duas vezes, mesmo com a tela apagada. Acorda a tela por alguns segundos.
 */
public class SpeakService extends Service implements TextToSpeech.OnInitListener {
    private static final int FOREGROUND_ID = 4201;
    private static final long TIMEOUT_MS = 60_000;
    private static final long FIRST_DELAY_MS = 1500;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private PowerManager.WakeLock wakeLock;
    private String spoken = "";
    private int round = 0;
    private boolean finished = false;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String id = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_ID) : null;
        String title = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(ReminderScheduler.EXTRA_BODY) : null;
        spoken = intent != null && intent.getStringExtra(ReminderScheduler.EXTRA_SPOKEN) != null
                ? intent.getStringExtra(ReminderScheduler.EXTRA_SPOKEN)
                : (title != null ? "Lembrete: " + title : "Lembrete");
        if (title == null) title = "Lembrete";

        Notifications.ensureChannels(this);
        Notification n =
                new NotificationCompat.Builder(this, Notifications.CHANNEL_REMINDERS)
                        .setSmallIcon(android.R.drawable.ic_popup_reminder)
                        .setContentTitle(title)
                        .setContentText(body != null ? body : "")
                        .setContentIntent(Notifications.openApp(this))
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setCategory(NotificationCompat.CATEGORY_ALARM)
                        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                        .setAutoCancel(true)
                        .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, FOREGROUND_ID, n, type);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && wakeLock == null) {
            //noinspection deprecation
            wakeLock =
                    pm.newWakeLock(
                            PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                            "myday:lembrete");
            wakeLock.acquire(TIMEOUT_MS);
        }

        tts = new TextToSpeech(this, this);
        handler.postDelayed(this::finish, TIMEOUT_MS);
        return START_NOT_STICKY;
    }

    @Override
    public void onInit(int status) {
        if (status != TextToSpeech.SUCCESS) {
            finish();
            return;
        }
        int lang = tts.setLanguage(new Locale("pt", "BR"));
        if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) {
            tts.setLanguage(Locale.getDefault());
        }
        tts.setAudioAttributes(
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
        tts.setOnUtteranceProgressListener(
                new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        round++;
                        if (round >= 2) handler.post(SpeakService.this::finish);
                        else handler.postDelayed(SpeakService.this::speakOnce, 1500);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        handler.post(SpeakService.this::finish);
                    }
                });
        // Dá tempo do som da notificação tocar antes da voz.
        handler.postDelayed(this::speakOnce, FIRST_DELAY_MS);
    }

    private void speakOnce() {
        if (finished || tts == null) return;
        tts.speak(spoken, TextToSpeech.QUEUE_FLUSH, null, "lembrete-" + round);
    }

    private void finish() {
        if (finished) return;
        finished = true;
        handler.removeCallbacksAndMessages(null);
        // A notificação continua na barra depois que o serviço termina.
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
