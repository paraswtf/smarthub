#pragma once
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Arduino.h>
#include "Storage.h"
#include "Debug.h"
#include "Config.h"

static const char CONFIG_PAGE[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SmartHUB Setup</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#050f08;color:#dde6f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#071009;border:1px solid rgba(18,201,132,.15);border-radius:16px;padding:32px;width:100%;max-width:420px}
  h1{font-size:22px;font-weight:700;margin-bottom:4px;color:#e8f0ea}
  p.sub{font-size:13px;color:#7a9080;margin-bottom:24px}
  label{display:block;font-size:12px;font-weight:600;color:#9ab8a4;margin-bottom:6px;margin-top:16px}
  input,select{width:100%;padding:10px 14px;border-radius:8px;border:1px solid rgba(18,201,132,.2);background:#0a160d;color:#e8f0ea;font-size:14px;outline:none}
  input:focus,select:focus{border-color:#12c984}
  .row{display:flex;gap:12px}
  .row>div{flex:1}
  button[type=submit]{margin-top:24px;width:100%;padding:12px;background:#12c984;color:#040c06;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer}
  button[type=submit]:hover{background:#0faa70}
  .note{font-size:12px;color:#4a6b58;margin-top:16px;line-height:1.5}
  .dev-toggle{display:flex;align-items:center;gap:10px;margin-top:20px;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,165,0,.2);background:rgba(255,165,0,.05);cursor:pointer}
  .dev-toggle input{width:auto;accent-color:#ffa500}
  .dev-toggle span{font-size:13px;font-weight:600;color:#ffa500}
  .dev-fields{display:none}
  .dev-fields.show{display:block}
  .prod-info{margin-top:16px;padding:10px 14px;border-radius:8px;background:rgba(18,201,132,.05);border:1px solid rgba(18,201,132,.15);font-size:12px;color:#7a9080}
</style>
</head>
<body>
<div class="card">
  <h1>⚡ SmartHUB Setup</h1>
  <p class="sub">Configure your device to connect to SmartHUB.</p>
  <form method="POST" action="/save">
    <label>WiFi Network (SSID)</label>
    <input name="ssid" placeholder="Your home WiFi name" required value="%SSID%">
    <label>WiFi Password</label>
    <input name="pass" type="password" placeholder="Leave empty if open network">
    <label>Device Name</label>
    <input name="name" placeholder="e.g. Living Room Board" required value="%NAME%">
    <label>API Key</label>
    <input name="key" placeholder="ehk_..." required value="%KEY%">
    <label>Server Host</label>
    <input name="host" placeholder="myserver.com" required value="%HOST%">

    <input type="hidden" name="devmode" id="devmode-val" value="%DEVMODE%">
    <label class="dev-toggle" onclick="toggleDev()">
      <input type="checkbox" id="devcheck" onchange="toggleDev()" %DEV_CHECKED%>
      <span>Dev Mode</span>
    </label>

    <div id="dev-fields" class="dev-fields %DEV_SHOW%">
      <div class="row">
        <div><label>API Port</label><input name="port" type="number" value="%PORT%" min="1" max="65535"></div>
        <div><label>WS Port</label><input name="wsport" type="number" value="%WSPORT%" min="1" max="65535"></div>
      </div>
    </div>

    <div id="prod-info" class="prod-info" %PROD_HIDE%>
      Uses port 443 with WSS (secure).
    </div>

    <button type="submit">Save &amp; Connect</button>
  </form>
  <p class="note">After saving the device will reboot and connect to your network.</p>
</div>
<script>
function toggleDev(){
  var c=document.getElementById('devcheck');
  var d=document.getElementById('dev-fields');
  var p=document.getElementById('prod-info');
  var v=document.getElementById('devmode-val');
  // Sync hidden value
  v.value=c.checked?'1':'0';
  if(c.checked){d.classList.add('show');p.style.display='none';}
  else{d.classList.remove('show');p.style.display='block';}
}
</script>
</body>
</html>
)rawhtml";

class CaptivePortal
{
public:
  bool run(DeviceConfig &cfg)
  {
    _saved = false;
    _cfg = &cfg;

    WiFi.mode(WIFI_AP);
    WiFi.softAPConfig(
        IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
    WiFi.softAP(AP_SSID, strlen(AP_PASSWORD) > 0 ? AP_PASSWORD : nullptr);

    DBG_PORTAL("AP started — SSID: %s  IP: 192.168.4.1", AP_SSID);

    _dns.start(53, "*", IPAddress(192, 168, 4, 1));

    _server.on("/", HTTP_GET, [this]()
               { _handleRoot(); });
    _server.on("/save", HTTP_POST, [this]()
               { _handleSave(); });
    _server.on("/generate_204", HTTP_GET, [this]()
               { _handleRoot(); });
    _server.on("/hotspot-detect.html", HTTP_GET, [this]()
               { _handleRoot(); });
    _server.onNotFound([this]()
                       { _handleRoot(); });
    _server.begin();

    DBG_PORTAL("Web server started — waiting for configuration…");

    uint32_t start = millis();
    while (!_saved)
    {
      _dns.processNextRequest();
      _server.handleClient();
      if (millis() - start > CONFIG_PORTAL_TIMEOUT_MS)
      {
        DBG_WARN("Portal timeout (%d ms) — rebooting", CONFIG_PORTAL_TIMEOUT_MS);
        ESP.restart();
      }
      delay(2);
    }

    _server.stop();
    _dns.stop();
    WiFi.softAPdisconnect(true);
    return true;
  }

private:
  WebServer _server{80};
  DNSServer _dns;
  DeviceConfig *_cfg = nullptr;
  bool _saved = false;

  void _handleRoot()
  {
    DBG_PORTAL("Serving config page to %s", _server.client().remoteIP().toString().c_str());
    String page = FPSTR(CONFIG_PAGE);
    page.replace("%SSID%", _cfg->wifiSSID);
    page.replace("%NAME%", _cfg->deviceName);
    page.replace("%KEY%", _cfg->apiKey);
    page.replace("%HOST%", _cfg->serverHost);
    page.replace("%PORT%", String(_cfg->serverPort));
    page.replace("%WSPORT%", String(_cfg->wsPort));
    page.replace("%DEVMODE%", _cfg->devMode ? "1" : "0");
    page.replace("%DEV_CHECKED%", _cfg->devMode ? "checked" : "");
    page.replace("%DEV_SHOW%", _cfg->devMode ? "show" : "");
    page.replace("%PROD_HIDE%", _cfg->devMode ? "style=\"display:none\"" : "");
    _server.send(200, "text/html; charset=utf-8", page);
  }

  void _handleSave()
  {
    if (!_server.hasArg("ssid") || !_server.hasArg("key") || !_server.hasArg("host"))
    {
      DBG_ERR("Portal /save — missing fields");
      _server.send(400, "text/plain", "Missing fields");
      return;
    }

    _cfg->wifiSSID = _server.arg("ssid");
    _cfg->wifiPassword = _server.arg("pass");
    _cfg->deviceName = _server.arg("name");
    _cfg->apiKey = _server.arg("key");
    _cfg->serverHost = _server.arg("host");
    _cfg->devMode = _server.arg("devmode") == "1";

    if (_cfg->devMode)
    {
      _cfg->serverPort = _server.arg("port").toInt();
      _cfg->wsPort = _server.arg("wsport").toInt();
      _cfg->serverSecure = false; // dev mode always uses plain WS
    }
    else
    {
      _cfg->serverPort = 443;
      _cfg->wsPort = 443;
      _cfg->serverSecure = true; // production always uses WSS
    }

    DBG_PORTAL("Config saved — ssid=%s  host=%s  apiPort=%d  wsPort=%d  tls=%d  devMode=%d  name=%s",
               _cfg->wifiSSID.c_str(), _cfg->serverHost.c_str(),
               _cfg->serverPort, _cfg->wsPort, _cfg->serverSecure,
               _cfg->devMode, _cfg->deviceName.c_str());

    Storage::save(*_cfg);

    _server.send(200, "text/html; charset=utf-8",
                 "<html><head><meta charset='UTF-8'></head>"
                 "<body style='font-family:sans-serif;background:#050f08;color:#12c984;"
                 "display:flex;align-items:center;justify-content:center;height:100vh;margin:0'>"
                 "<div style='text-align:center'><h2>✓ Saved!</h2><p style='color:#7a9080'>Rebooting…</p></div></body></html>");

    delay(1500);
    _saved = true;
    ESP.restart();
  }
};