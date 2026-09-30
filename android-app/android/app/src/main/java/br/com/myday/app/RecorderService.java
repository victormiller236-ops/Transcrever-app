package br.com.myday.app;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.ByteArrayOutputStream;

/**
 * Grava o microfone dentro de um serviço em primeiro plano (tipo "microphone").
 * É isso que permite continuar gravando com a tela apagada ou com outro app na frente.
 * Formato: AAC (ADTS), 16 kHz, mono, 32 kbps ≈ 4 KB/s, que o Gemini aceita direto.
 */
public class RecorderService extends Service {
    private static final int NOTIFICATION_ID = 4101;
    private static final int MAX_MS = 20 * 60 * 1000;

    private static final Object LOCK = new Object();
    private static MediaRecorder recorder;
    private static File file;
    private static long startedAt;
    private static boolean recording;
    private static RecorderService instance;

    private PowerManager.WakeLock wakeLock;

    /** Resultado de uma gravação encerrada. */
    static final class Result {
        final byte[] bytes;
        final long millis;

        Result(byte[] bytes, long millis) {
            this.bytes = bytes;
            this.millis = millis;
        }
    }

    static boolean isRecording() {
        synchronized (LOCK) {
            return recording;
        }
    }

    /** Volume atual, de 0 a 1. */
    static double level() {
        synchronized (LOCK) {
            if (!recording || recorder == null) return 0;
            try {
                return Math.min(1.0, recorder.getMaxAmplitude() / 12000.0);
            } catch (RuntimeException e) {
                return 0;
            }
        }
    }

    static Result stop() throws IOException {
        Result result = null;
        synchronized (LOCK) {
            if (recorder != null) {
                long millis = System.currentTimeMillis() - startedAt;
                try {
                    recorder.stop();
                } catch (RuntimeException ignored) {
                    // parada logo após iniciar: o arquivo pode ficar inválido
                }
                recorder.release();
                recorder = null;
                recording = false;
                if (file != null && file.exists()) {
                    result = new Result(readAll(file), millis);
                    //noinspection ResultOfMethodCallIgnored
                    file.delete();
                }
                file = null;
            }
        }
        RecorderService svc = instance;
        if (svc != null) svc.finish();
        return result;
    }

    static void cancel() {
        synchronized (LOCK) {
            if (recorder != null) {
                try {
                    recorder.stop();
                } catch (RuntimeException ignored) {
                }
                recorder.release();
                recorder = null;
            }
            recording = false;
            if (file != null) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
                file = null;
            }
        }
        RecorderService svc = instance;
        if (svc != null) svc.finish();
    }

    private static byte[] readAll(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f);
                ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(1024, f.length()))) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        instance = this;
        Notifications.ensureChannels(this);
        Notification n =
                new NotificationCompat.Builder(this, Notifications.CHANNEL_RECORDING)
                        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                        .setContentTitle("MyDay está gravando")
                        .setContentText("Toque para voltar ao app")
                        .setContentIntent(Notifications.openApp(this))
                        .setOngoing(true)
                        .setOnlyAlertOnce(true)
                        .setCategory(NotificationCompat.CATEGORY_SERVICE)
                        .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && wakeLock == null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "myday:gravacao");
            wakeLock.acquire(MAX_MS + 30_000L);
        }

        synchronized (LOCK) {
            if (!recording) {
                try {
                    startRecorder();
                } catch (Exception e) {
                    recording = false;
                    if (recorder != null) {
                        recorder.release();
                        recorder = null;
                    }
                    finish();
                }
            }
        }
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private void startRecorder() throws IOException {
        file = new File(getCacheDir(), "gravacao.aac");
        MediaRecorder r = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? new MediaRecorder(this) : new MediaRecorder();
        r.setAudioSource(MediaRecorder.AudioSource.MIC);
        r.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
        r.setAudioSamplingRate(16000);
        r.setAudioChannels(1);
        r.setAudioEncodingBitRate(32000);
        r.setMaxDuration(MAX_MS);
        r.setOutputFile(file.getAbsolutePath());
        r.prepare();
        r.start();
        recorder = r;
        startedAt = System.currentTimeMillis();
        recording = true;
    }

    void finish() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
        instance = null;
    }

    @Override
    public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
