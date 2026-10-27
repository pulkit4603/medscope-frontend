package com.anonymous.withtypescript.wifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * Listens for stethoscope UDP audio on the board's Wi-Fi only.
 * The process default network stays on mobile data, so analysis uploads still work.
 */
class StethoscopeWifiModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val connectivityManager =
    reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var socket: DatagramSocket? = null
  @Volatile private var listening = false

  override fun getName(): String = "StethoscopeWifi"

  @ReactMethod
  fun start(ssid: String, password: String, port: Int, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("E_WIFI_API", "Stethoscope Wi-Fi binding requires Android 10 or newer")
      return
    }

    reactContext.runOnUiQueueThread {
      try {
        stopInternal()
        val existing = findExistingNetwork(ssid)
        if (existing != null) {
          reportConnected(existing, port)
          promise.resolve(true)
          return@runOnUiQueueThread
        }

        val specifier = WifiNetworkSpecifier.Builder()
          .setSsid(ssid)
          .setWpa2Passphrase(password)
          .build()

        val request = NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .setNetworkSpecifier(specifier)
          .build()

        val callback = object : ConnectivityManager.NetworkCallback() {
          override fun onAvailable(network: Network) {
            reportConnected(network, port)
          }

          override fun onUnavailable() {
            emitStatus("unavailable")
          }

          override fun onLost(network: Network) {
            emitStatus("lost")
            closeSocket()
          }
        }

        networkCallback = callback
        connectivityManager.requestNetwork(request, callback)
        emitStatus("requesting")
        promise.resolve(true)
      } catch (error: Exception) {
        emitStatus("unavailable")
        promise.reject("E_WIFI_START", error.message, error)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    reactContext.runOnUiQueueThread {
      stopInternal()
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
  }

  @ReactMethod
  fun removeListeners(count: Int) {
  }

  private fun findExistingNetwork(ssid: String): Network? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null

    return connectivityManager.allNetworks.firstOrNull { network ->
      val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return@firstOrNull false
      if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return@firstOrNull false
      val info = capabilities.transportInfo as? WifiInfo ?: return@firstOrNull false
      info.ssid?.trim('"') == ssid
    }
  }

  private fun reportConnected(network: Network, port: Int) {
    emitStatus("connected", localIpv4(network))
    openSocket(network, port)
  }

  /**
   * The board is the access point, so it is the network's gateway. Reading it from the
   * route table keeps working if the firmware's AP address ever changes.
   */
  private fun boardAddress(network: Network): InetAddress {
    val gateway = connectivityManager.getLinkProperties(network)
      ?.routes
      ?.firstOrNull { route -> route.isDefaultRoute && route.gateway is Inet4Address }
      ?.gateway
    return gateway ?: InetAddress.getByAddress(byteArrayOf(192.toByte(), 168.toByte(), 36, 1))
  }

  private fun localIpv4(network: Network): String? {
    val properties: LinkProperties = connectivityManager.getLinkProperties(network) ?: return null
    return properties.linkAddresses.firstOrNull { linkAddress ->
      val address = linkAddress.address
      address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress
    }?.address?.hostAddress
  }

  private fun openSocket(network: Network, port: Int) {
    closeSocket()
    try {
      val board = boardAddress(network)
      val datagramSocket = DatagramSocket(null)
      datagramSocket.reuseAddress = true
      network.bindSocket(datagramSocket)
      datagramSocket.bind(InetSocketAddress(port))
      socket = datagramSocket
      listening = true

      Thread {
        val buffer = ByteArray(2048)
        while (listening) {
          try {
            val packet = DatagramPacket(buffer, buffer.size)
            datagramSocket.receive(packet)
            // Other devices on the board's Wi-Fi may broadcast to this port too;
            // only the board's audio may reach a recording.
            if (packet.address != board) continue
            val payload = packet.data.copyOf(packet.length)
            emitPacket(payload)
          } catch (_: Exception) {
            break
          }
        }
      }.apply {
        name = "stethoscope-udp"
        start()
      }
    } catch (error: Exception) {
      emitStatus("unavailable")
    }
  }

  private fun closeSocket() {
    listening = false
    try {
      socket?.close()
    } catch (_: Exception) {
    }
    socket = null
  }

  private fun stopInternal() {
    networkCallback?.let { callback ->
      try {
        connectivityManager.unregisterNetworkCallback(callback)
      } catch (_: Exception) {
      }
    }
    networkCallback = null
    closeSocket()
  }

  private fun emitStatus(status: String, address: String? = null) {
    val body = Arguments.createMap()
    body.putString("status", status)
    if (address != null) {
      body.putString("address", address)
    }
    emit("stethoscopeStatus", body)
  }

  private fun emitPacket(bytes: ByteArray) {
    val body = Arguments.createMap()
    body.putString("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
    emit("stethoscopePacket", body)
  }

  private fun emit(event: String, body: com.facebook.react.bridge.WritableMap) {
    if (!reactContext.hasActiveReactInstance()) return
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(event, body)
  }
}
