package com.cineclube.app.screencast;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

public class ScreenCastService extends Service {
  private static final String CHANNEL = "cineclube-transmissao";
  private static final int ID = 8021;

  public interface Pronto {
    void aconteceu();
  }

  private static Pronto esperando;

  public static void start(Context context, Pronto pronto) {
    esperando = pronto;
    Intent intent = new Intent(context, ScreenCastService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
    else context.startService(intent);
  }

  public static void stop(Context context) {
    esperando = null;
    context.stopService(new Intent(context, ScreenCastService.class));
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Notification aviso =
        new NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("Transmitindo para o clube")
            .setContentText("Sua tela está sendo mostrada na Sessão.")
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(ID, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
    } else {
      startForeground(ID, aviso);
    }
    final Pronto quem = esperando;
    esperando = null;
    if (quem != null) new android.os.Handler(android.os.Looper.getMainLooper()).post(quem::aconteceu);

    return START_NOT_STICKY;
  }

  @Override
  public void onCreate() {
    super.onCreate();
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
    NotificationChannel canal =
        new NotificationChannel(CHANNEL, "Transmissão", NotificationManager.IMPORTANCE_LOW);
    canal.setDescription("Enquanto sua tela está indo para a Sessão do clube.");
    manager.createNotificationChannel(canal);
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}
