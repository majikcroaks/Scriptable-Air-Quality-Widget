// Variables used by Scriptable.
// icon-color: deep-green; icon-glyph: leaf;
// Based on code from Jason Snell , Matt Silverlock
// Inspired by Apple Shortcuts from jickey@PTT-iOS
// API powered by Location Aware Sensing System (LASS) and IIS-NRL, Academia Sinica 

const API_URL = "https://pm25.lass-net.org/API-1.0.0/";
const AIRBOX_FALLBACK_FEED_URL = "https://pm25.lass-net.org/AirBox/other.json";
const FALLBACK_CANDIDATE_LIMIT = 5;
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const LAST_GOOD_DEVICE_TTL_MS = 30 * 60 * 1000;
const CACHE_KEY_PREFIX = "air_widget_cache_v1";
const FEED_CACHE_KEY = `${CACHE_KEY_PREFIX}_feed`;
const LAST_GOOD_DEVICE_KEY = `${CACHE_KEY_PREFIX}_last_good`;
let memoryFeedCache = null;

function roundToDecimals(value, decimals) {
    return Number(value.toFixed(decimals));
}

function smartShortenSiteName(name, maxLen = 12) {
    if (!name) return "未知站點";

    let s = String(name);
    s = s
        .replace(/（[^）]*）/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/【[^】]*】/g, "")
        .replace(/\[[^\]]*\]/g, "");

    s = s.replace(/區段標|第一期工程|第二期工程|工程|計畫|工區|案/g, "");

    s = s
        .replace(/\s+/g, " ")
        .replace(/[-–—]{2,}/g, "-")
        .replace(/\s*-\s*/g, "-")
        .trim();

    if (!s) s = "未知站點";
    if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
    return s;
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
            // Use one request per URL and parse tolerantly from raw text.
            const rawText = await req.loadString();
            if (!rawText || rawText.trim().length === 0) {
                console.log(`Nearest endpoint empty body on ${url}`);
                continue;
            }

            const normalizedText = rawText.trim().replace(/^\)\]\}',?\s*/, "");
            let payload = null;
            try {
                payload = JSON.parse(normalizedText);
            } catch (parseError) {
                payload = null;
            }

            const nearestDeviceId = extractDeviceIdFromNearestPayload(payload);
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
        } catch (error) {
            console.log(`Nearest endpoint request/parse failed on ${url}: ${error}`);
        }
    }

    return null;
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

function setJsonCache(key, value) {
    try {
        Keychain.set(key, JSON.stringify(value));
    } catch (e) {
        console.log(`Cache write skipped for ${key}: ${e}`);
    }
}

function getJsonCache(key) {
    try {
        if (!Keychain.contains(key)) return null;
        const raw = Keychain.get(key);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.log(`Cache read skipped for ${key}: ${e}`);
        return null;
    }
}

function isFreshCache(cacheObj, ttlMs) {
    if (!cacheObj || typeof cacheObj !== "object") return false;
    if (typeof cacheObj.cachedAt !== "number") return false;
    return (Date.now() - cacheObj.cachedAt) <= ttlMs;
}

async function getFallbackFeedData() {
    if (isFreshCache(memoryFeedCache, FEED_CACHE_TTL_MS) && Array.isArray(memoryFeedCache.feeds)) {
        return memoryFeedCache.feeds;
    }

    const diskCache = getJsonCache(FEED_CACHE_KEY);
    if (isFreshCache(diskCache, FEED_CACHE_TTL_MS) && Array.isArray(diskCache.feeds)) {
        memoryFeedCache = diskCache;
        return diskCache.feeds;
    }

    const req = new Request(AIRBOX_FALLBACK_FEED_URL);
    req.headers = { Accept: "application/json" };
    let payload;
    try {
        payload = await req.loadJSON();
    } catch (e) {
        console.log(`Fallback feed parse failed: ${e}`);
        return [];
    }

    const feeds = payload && Array.isArray(payload.feeds) ? payload.feeds : [];
    if (feeds.length === 0) return [];
    const cachePayload = { cachedAt: Date.now(), feeds };
    memoryFeedCache = cachePayload;
    setJsonCache(FEED_CACHE_KEY, cachePayload);
    return feeds;
}

async function getFallbackNearestIds(lat, lon, limit) {
    const feeds = await getFallbackFeedData();
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
    if (withDistance.length > 0) {
        console.log(`Fallback nearest distance: ${withDistance[0].distanceKm.toFixed(3)} km`);
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

function getLastGoodDeviceId() {
    const cached = getJsonCache(LAST_GOOD_DEVICE_KEY);
    if (!isFreshCache(cached, LAST_GOOD_DEVICE_TTL_MS)) return null;
    if (!cached.deviceId || typeof cached.deviceId !== "string") return null;
    return cached.deviceId;
}

function setLastGoodDeviceId(deviceId) {
    setJsonCache(LAST_GOOD_DEVICE_KEY, {
        cachedAt: Date.now(),
        deviceId
    });
}

//Get sensor data.
async function getSensorData() {
    const { lat, lon } = await getCurrentCoordinates();
    const candidates = [];
    const seenCandidates = new Set();
    const pushCandidate = (id) => {
        if (!id || typeof id !== "string") return;
        if (seenCandidates.has(id)) return;
        seenCandidates.add(id);
        candidates.push(id);
    };

    // 1) Prioritize last known good device for faster success path.
    const lastGoodDeviceId = getLastGoodDeviceId();
    if (lastGoodDeviceId) {
        console.log(`Trying last known good sensor first: ${lastGoodDeviceId}`);
        pushCandidate(lastGoodDeviceId);
    }

    // 2) Try nearest endpoint (may return null/empty body).
    const nearestDeviceId = await getNearestDeviceId(lat, lon);
    if (nearestDeviceId) {
        pushCandidate(nearestDeviceId);
    } else {
        console.log("Nearest endpoint unavailable, switching to feed fallback.");
    }

    // 3) Add nearby fallback candidates from one shared feed fetch.
    const fallbackCandidates = await getFallbackNearestIds(lat, lon, FALLBACK_CANDIDATE_LIMIT);
    for (let i = 0; i < fallbackCandidates.length; i++) {
        pushCandidate(fallbackCandidates[i]);
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
            setLastGoodDeviceId(deviceId);
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
        wg.backgroundColor = new Color(level.backgroundColor || 'F7F7F7');

        // Top block: AQ label + PM2.5 + met data
        let header = wg.addText(`${level.label}`);
        header.textColor = new Color(textColor);
        header.font = Font.boldSystemFont(14);
        header.lineLimit = 1;

        wg.addSpacer(4);

        // Line 2: PM2.5 large number
        let pmLine = wg.addText(`${pm25}`);
        pmLine.textColor = new Color(textColor);
        pmLine.font = Font.boldSystemFont(28);
        pmLine.lineLimit = 1;

        wg.addSpacer(4);

        // Line 3: temperature / humidity
        let metLine = wg.addText(`${temp}°C / RH ${RH}%`);
        metLine.textColor = new Color(textColor);
        metLine.font = Font.regularSystemFont(11);
        metLine.lineLimit = 1;

        // Flexible spacer to avoid visual crowding in small widget.
        wg.addSpacer();

        // Bottom block: site + update time
        let displayName = smartShortenSiteName(name, 12);
        let siteLine = wg.addText(displayName);
        siteLine.textColor = new Color(textColor);
        siteLine.font = Font.mediumSystemFont(11);
        siteLine.lineLimit = 1;

        wg.addSpacer(3);

        let updatedAt = new Date(data.timestamp).toLocaleDateString('en-US', {
            timeZone: "GMT",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: '2-digit',
            minute: '2-digit'
        });
        console.log(updatedAt);
        // Line 5: update time (tiny)
        let ts = wg.addText(`${updatedAt}`);
        ts.textColor = new Color(textColor);
        ts.font = Font.lightSystemFont(9);
        ts.lineLimit = 1;

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
