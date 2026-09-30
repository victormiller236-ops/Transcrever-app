package br.com.myday.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Os plugins precisam ser registrados antes do super.onCreate.
        registerPlugin(NativeVoicePlugin.class);
        registerPlugin(NativeRemindersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
