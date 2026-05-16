# Scriptable-Air-Quality-Widget
Airquality widget for scriptable app on iOS 14

1. 在iPhone上安裝Scriptable App
https://apps.apple.com/tw/app/scriptable/id1405459188

2. 安裝捷徑來儲存Widget程式碼，執行後存到Scriptable資料夾
https://routinehub.co/shortcut/7028/

4. 執行一次剛剛新增的 Widget 程式碼 (為了取得權限)

5. 新增小工具到桌面

6. 長按小工具，選編輯小工具

7. 第一個選項選擇剛剛步驟2抓下來的Airbox

8. 其餘的不動 完成

<pre><code>
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: light-brown; icon-glyph: magic;
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: light-brown; icon-glyph: magic;
// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: light-brown; icon-glyph: magic;

// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: leaf;
// Based on code by Jason Snell , Matt Silverlock
// Inspired and based on Apple Shortcuts by jickey@PTT-iOS
// API powered by Powered by Location Aware Sensing System (LASS) and IIS-NRL, Academia Sinica 

const API_URL = "https://pm25.lass-net.org/API-1.0.0/";
const AIRBOX_FALLBACK_FEED_URL = "https://pm25.lass-net.org/AirBox/other.json";

function roundToDecimals(value, decimals) {
    return Number(value.toFixed(decimals));
}

async function getCurrentCoordinates() {
    console.log("Getting coordinates...");
    const location = await Location.current();
    const rawLat = Number(location.latitude);
    const rawLon = Number(location.longitude);
    const lat = roundToDecimals(rawLat, 2);
    const lon = roundToDecimals(rawLon, 2);
    if (Number.isNaN(lat) || Number.isNaN(lon)) {
        throw new Error("Unable to get valid latitude/longitude from device location.");
    }
    console.log(`raw lat/lon: ${rawLat}, ${rawLon}`);
    console.log(`lat: ${lat}, lon: ${lon}`);
    return { lat, lon };
}

function extractDeviceIdFromNearestPayload(payload) {
    const feeds = payload && Array.isArray(payload.feeds) ? payload.feeds : [];
    if (feeds.length === 0) return null;

    const first = feeds[0];
    if (!first || typeof first !== "object") return null;

    if (typeof first.device_id === "string" && first.device_id.trim()) {
        return first.device_id.trim();
    }

    const keys = Object.keys(first);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = first[key];

        if (value && typeof value === "object" && typeof value.device_id === "string" && value.device_id.trim()) {
            return value.device_id.trim();
        }

        if (/^[0-9A-F]{8,}$/i.test(key)) {
            return key;
        }
    }

    return null;
}

async function getNearestDeviceId(lat, lon) {
    console.log("Fetching nearest sensor list...");
    const roundedLat = Number(lat).toFixed(2);
    const roundedLon = Number(lon).toFixed(2);
    console.log(`nearest request lat/lon (rounded): ${roundedLat}, ${roundedLon}`);
    const latEncoded = encodeURIComponent(roundedLat);
    const lonEncoded = encodeURIComponent(roundedLon);
    const candidateUrls = [
        `${API_URL}device/nearest/lat/${latEncoded}/lon/${lonEncoded}/`,
        `${API_URL}device/nearest/lat/${latEncoded}/lon/${lonEncoded}/?format=JSON`,
        `${API_URL}device/nearest/lat/${latEncoded}/lon/${lonEncoded}/?format=json`
    ];

    for (let i = 0; i < candidateUrls.length; i++) {
        const url = candidateUrls[i];
        const req = new Request(url);
        req.headers = { Accept: "application/json" };
        try {
            const payload = await req.loadJSON();
            const nearestDeviceId = extractDeviceIdFromNearestPayload(payload);
            if (nearestDeviceId) {
                console.log(`Using nearest sensor: ${nearestDeviceId}`);
                return nearestDeviceId;
            }
        } catch (jsonError) {
            try {
                const rawReq = new Request(url);
                rawReq.headers = { Accept: "application/json" };
                const rawText = await rawReq.loadString();
                if (!rawText || rawText.trim().length === 0) {
                    console.log(`Nearest endpoint empty body on ${url}`);
                    continue;
                }

                const normalizedText = rawText.trim().replace(/^\)\]\}',?\s*/, "");
                let parsed = null;
                try {
                    parsed = JSON.parse(normalizedText);
                } catch (parseError) {
                    parsed = null;
                }

                const nearestDeviceId = extractDeviceIdFromNearestPayload(parsed);
                if (nearestDeviceId) {
                    console.log(`Using nearest sensor: ${nearestDeviceId}`);
                    return nearestDeviceId;
                }

                const byField = normalizedText.match(/"device_id"\s*:\s*"([^"]+)"/i);
                if (byField && byField[1]) {
                    console.log(`Using nearest sensor (regex device_id): ${byField[1]}`);
                    return byField[1];
                }
                const byKey = normalizedText.match(/\{\s*"([0-9A-F]{8,})"\s*:\s*\{/i);
                if (byKey && byKey[1]) {
                    console.log(`Using nearest sensor (regex key): ${byKey[1]}`);
                    return byKey[1];
                }
            } catch (rawError) {
                console.log(`Nearest endpoint parse failed on ${url}: ${rawError}`);
            }
            console.log(`Nearest endpoint JSON parse failed on ${url}: ${jsonError}`);
        }
    }

    console.log("Falling back to AirBox feed distance lookup...");
    const fallbackDeviceId = await getNearestDeviceIdFromFeed(lat, lon);
    if (fallbackDeviceId) {
        console.log(`Using nearest sensor (fallback feed): ${fallbackDeviceId}`);
        return fallbackDeviceId;
    }

    throw new Error("No nearby AirBox device found or nearest endpoint response is invalid.");
}

function toRad(value) {
    return value * Math.PI / 180;
}

function calcDistanceKm(lat1, lon1, lat2, lon2) {
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

async function getNearestDeviceIdFromFeed(lat, lon) {
    const req = new Request(AIRBOX_FALLBACK_FEED_URL);
    req.headers = { Accept: "application/json" };
    let payload;
    try {
        payload = await req.loadJSON();
    } catch (e) {
        console.log(`Fallback feed JSON parse failed: ${e}`);
        return null;
    }

    const feeds = payload && Array.isArray(payload.feeds) ? payload.feeds : [];
    if (feeds.length === 0) {
        console.log("Fallback feed has no sensors.");
        return null;
    }

    let bestDeviceId = null;
    let bestDistanceKm = Number.POSITIVE_INFINITY;
    for (let i = 0; i < feeds.length; i++) {
        const sensor = feeds[i];
        const sensorLat = Number(sensor.gps_lat);
        const sensorLon = Number(sensor.gps_lon);
        if (Number.isNaN(sensorLat) || Number.isNaN(sensorLon)) {
            continue;
        }
        const deviceId = String(sensor.site_id || sensor.device_id || "").trim();
        if (!deviceId) {
            continue;
        }

        const distanceKm = calcDistanceKm(lat, lon, sensorLat, sensorLon);
        if (distanceKm < bestDistanceKm) {
            bestDistanceKm = distanceKm;
            bestDeviceId = deviceId;
        }
    }

    if (!bestDeviceId) {
        console.log("Fallback feed cannot resolve any valid device_id.");
        return null;
    }
    console.log(`Fallback nearest distance: ${bestDistanceKm.toFixed(3)} km`);
    return bestDeviceId;
}

async function getNearestDeviceIdsFromFeed(lat, lon, limit) {
    const req = new Request(AIRBOX_FALLBACK_FEED_URL);
    req.headers = { Accept: "application/json" };
    let payload;
    try {
        payload = await req.loadJSON();
    } catch (e) {
        console.log(`Fallback feed candidate parse failed: ${e}`);
        return [];
    }

    const feeds = payload && Array.isArray(payload.feeds) ? payload.feeds : [];
    if (feeds.length === 0) return [];

    const withDistance = [];
    for (let i = 0; i < feeds.length; i++) {
        const sensor = feeds[i];
        const sensorLat = Number(sensor.gps_lat);
        const sensorLon = Number(sensor.gps_lon);
        const deviceId = String(sensor.site_id || sensor.device_id || "").trim();
        if (!deviceId || Number.isNaN(sensorLat) || Number.isNaN(sensorLon)) continue;
        withDistance.push({
            deviceId,
            distanceKm: calcDistanceKm(lat, lon, sensorLat, sensorLon)
        });
    }

    withDistance.sort((a, b) => a.distanceKm - b.distanceKm);
    const ids = [];
    const seen = new Set();
    for (let i = 0; i < withDistance.length; i++) {
        const id = withDistance[i].deviceId;
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        if (ids.length >= limit) break;
    }
    return ids;
}

function extractLatestData(raw) {
    if (!raw || !raw.feeds) return null;

    if (Array.isArray(raw.feeds)) {
        if (raw.feeds[0] && raw.feeds[0].AirBox) return raw.feeds[0].AirBox;
        if (raw.feeds[0]) return raw.feeds[0];
    }

    if (raw.feeds && typeof raw.feeds === "object") {
        const keys = Object.keys(raw.feeds);
        if (keys.length > 0) {
            const firstFeed = raw.feeds[keys[0]];
            if (firstFeed && typeof firstFeed === "object") return firstFeed;
        }
    }

    return null;
}

function isValidAirboxReading(data) {
    if (!data) return false;
    const temp = Number(data.s_t0);
    const rh = Number(data.s_h0);
    const pm25 = Number(data.s_d0);
    if (Number.isNaN(temp) || Number.isNaN(rh) || Number.isNaN(pm25)) return false;

    // Basic sanity ranges to avoid broken sensors.
    if (temp < -20 || temp > 60) return false;
    if (rh <= 0 || rh > 100) return false;
    if (pm25 < 0 || pm25 > 1000) return false;
    return true;
}

async function fetchLatestDataByDeviceId(deviceId) {
    const sensorData = new Request(`${API_URL}device/${deviceId}/latest/?format=JSON`);
    sensorData.headers = { Accept: "application/json" };
    const raw = await sensorData.loadJSON();
    const data = extractLatestData(raw);
    if (!data) {
        throw new Error(`AirBox latest data payload is missing for ${deviceId}.`);
    }
    return data;
}

//Get sensor data.
async function getSensorData() {
    const { lat, lon } = await getCurrentCoordinates();
    const firstDeviceId = await getNearestDeviceId(lat, lon);
    const candidates = [firstDeviceId];

    // Add more nearby candidates for automatic failover when primary has bad values.
    const fallbackCandidates = await getNearestDeviceIdsFromFeed(lat, lon, 10);
    for (let i = 0; i < fallbackCandidates.length; i++) {
        const id = fallbackCandidates[i];
        if (!candidates.includes(id)) candidates.push(id);
    }

    let lastError = null;
    for (let i = 0; i < candidates.length; i++) {
        const deviceId = candidates[i];
        try {
            const data = await fetchLatestDataByDeviceId(deviceId);
            if (!isValidAirboxReading(data)) {
                console.log(`Skip invalid reading from ${deviceId}: s_t0=${data.s_t0}, s_h0=${data.s_h0}, s_d0=${data.s_d0}`);
                continue;
            }

            if (i > 0) {
                console.log(`Switched to fallback sensor with valid data: ${deviceId}`);
            }
            return {
                temp: data.s_t0,
                RH: data.s_h0,
                pm25: data.s_d0,
                name: data.SiteName || data.name || deviceId,
                timestamp: data.timestamp
            };
        } catch (e) {
            lastError = e;
            console.log(`Failed to fetch latest for ${deviceId}: ${e}`);
        }
    }

    if (lastError) {
        throw lastError;
    }
    throw new Error("No nearby sensor provides valid PM2.5/temperature/humidity data.");
}



//Mapping the PM 2.5 levels with corresponding labels.
function getLevel(pm25) {
    let result = {
        threshold: "Getting data",
        label: "Calculating",
        backgroundColor: "F7F7F7",
        textColor: "112A46",
    }
    if (pm25 <= 15) {
        return {
            threshold: 15,
            label: "良好",
            backgroundColor: "E8F5E9",
            textColor: "1B5E20",
        }
    } else if (pm25 <= 35) {
        return {
            threshold: 35,
            label: "普通",
            backgroundColor: "FFF8E1",
            textColor: "8D6E63",
        }
    } else if (pm25 <= 54) {
        return {
            threshold: 54,
            label: "對敏感族群不健康",
            backgroundColor: "FFE0B2",
            textColor: "E65100",
        }
    } else if (pm25 <= 150) {
        return {
            threshold: 150,
            label: "不健康",
            backgroundColor: "FFCDD2",
            textColor: "B71C1C",
        }
    } else if (pm25 <= 250) {
        return {
            threshold: 250,
            label: "非常不健康",
            backgroundColor: "E1BEE7",
            textColor: "4A148C",
        }
    } else if (pm25 <= 999 || pm25 > 999) {
        return {
            threshold: 999,
            label: "有害",
            backgroundColor: "B71C1C",
            textColor: "FFFFFF",
        }
    }
    return result;
}
//Setting the widget layout.
~async function () {
    let wg = new ListWidget();
    wg.setPadding(20, 15, 20, 10);
    try {
        //Get data from getSensorData().
        let data = await getSensorData();
        console.log(data);
        let temp = data.temp;
        let RH = data.RH;
        let pm25 = data.pm25;
        let name = data.name;
        let level = getLevel(pm25);
        let textColor = level.textColor || '112A46';
        console.log(level);

        //let startColor = new Color(level.startColor);
        //let endColor = new Color(level.endColor);
        //let gradient = new LinearGradient({
        //    colors: [startColor, endColor],
        //    locations: [0, 1]
        //});
        //console.log(gradient);

        //wg.backgoundGradient = gradient;
        wg.backgroundColor = new Color(level.backgroundColor || 'F7F7F7');

        let header = wg.addText(`${level.label}`);
        header.textColor = new Color(textColor);
        header.font = Font.boldSystemFont(15);

        wg.addSpacer(10);

        let content = wg.addText(`粉塵 ${pm25} ug/m3`);
        content.textColor = new Color(textColor);
        content.font = Font.regularSystemFont(12);


        let wordTemp = wg.addText(`${temp}°C`);
        wordTemp.textColor = new Color(textColor);
        wordTemp.font = Font.regularSystemFont(12);

        let wordRH = wg.addText(`RH ${RH}%`);
        wordRH.textColor = new Color(textColor);
        wordRH.font = Font.regularSystemFont(12);

        wg.addSpacer(10);
        wg.addSpacer(10);

        let id = wg.addText(name);
        id.textColor = new Color(textColor);
        id.font = Font.mediumSystemFont(12);

        let updatedAt = new Date(data.timestamp).toLocaleDateString('en-US', {
            timeZone: "GMT",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: '2-digit',
            minute: '2-digit'
        });
        console.log(updatedAt);
        let ts = wg.addText(`${updatedAt}`);
        ts.textColor = new Color(textColor);
        ts.font = Font.lightSystemFont(10);

        //let purpleMap = 'https://www.purpleair.com/map?opt=1/i/mAQI/a10/cC0&select=' + SENSOR_ID + '#14/' + data.lat + '/' + data.lon

        //wg.url = purpleMap

    } catch (e) {
        console.log(e);
        let err = wg.addText(`error: ${e}`);
        err.textSize = 10;
        err.textColor = Color.red();
        err.textOpacity = 30;

    }

    wg.presentSmall();
    Script.setWidget(wg);
    Script.complete();
}();
</pre></code>
