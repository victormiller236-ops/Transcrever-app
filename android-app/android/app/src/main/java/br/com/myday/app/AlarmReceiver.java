package br.com.myday.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** Recebe o alarme do AlarmManager e entrega ao serviço que toca o aviso e fala. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra(ReminderScheduler.EXTRA_ID);
        if (id != null) ReminderScheduler.consumed(context, id);

        Intent svc = new Intent(context, SpeakService.class);
        svc.putExtra(ReminderScheduler.EXTRA_ID, id);
        svc.putExtra(ReminderScheduler.EXTRA_TITLE, intent.getStringExtra(ReminderScheduler.EXTRA_TITLE));
        svc.putExtra(ReminderScheduler.EXTRA_BODY, intent.getStringExtra(ReminderScheduler.EXTRA_BODY));
        svc.putExtra(ReminderScheduler.EXTRA_SPOKEN, intent.getStringExtra(ReminderScheduler.EXTRA_SPOKEN));
        ContextCompat.startForegroundService(context, svc);
    }
}
