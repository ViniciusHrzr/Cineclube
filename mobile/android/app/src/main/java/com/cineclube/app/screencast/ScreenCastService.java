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

/**
 * O SERVIÇO QUE MANTÉM A TRANSMISSÃO DE PÉ.
 *
 * <p>Não é cerimônia: do Android 10 em diante, capturar a tela exige um serviço
 * em primeiro plano com uma notificação visível, e do 14 em diante ele precisa
 * declarar que é DE PROJEÇÃO. Sem isso o sistema derruba a captura — ou mata o
 * aplicativo com uma exceção, que é o que acontece quando a ordem é invertida.
 *
 * <p>A ordem que o Android 14 cobra, e que ScreenCastPlugin segue: a permissão
 * de projeção é pedida PRIMEIRO, e o serviço sobe depois dela ser concedida.
 *
 * <p>A notificação é o que a pessoa usa para parar a transmissão de fora do
 * app, e é também a única coisa que o sistema mostra enquanto a tela está indo
 * para outro lugar. Ela diz isso com essas palavras.
 */
public class ScreenCastService extends Service {
  private static final String CHANNEL = "cineclube-transmissao";
  private static final int ID = 8021;

  public static void start(Context context) {
    Intent intent = new Intent(context, ScreenCastService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
    else context.startService(intent);
  }

  public static void stop(Context context) {
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
    /* Não reiniciar sozinho: uma transmissão que volta do nada depois de o
       sistema matar o app é uma tela sendo mostrada sem ninguém ter pedido. */
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
