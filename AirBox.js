// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: leaf;
// Based on code by Jason Snell <jsnell@sixcolors.com>, Matt Silverlock
// Inspired and based on Apple Shortcuts by jickey@PTT-iOS
// API powered by Location Aware Sensing System (LASS) and IIS-NRL, Academia Sinica 

const API_URL = "https://pm25.lass-net.org/API-1.0.0/";

// load and validate spotify credentials from iCloud Drive
async function loadSensor() {
    let fm = FileManager.iCloud();
    let dir = fm.documentsDirectory();
    let path = fm.joinPath(dir, "sensor.json");
    let sensor;
    if (fm.fileExists(path)) {
        await fm.downloadFileFromiCloud(path);
        let sensorFile = Data.fromFile(path);
        sensor = JSON.parse(sensorFile.toRawString());
        if (isNotEmpty(sensor.device_id)) {
            return sensor.device_id;
        }
    }
    return null;
}

async function getSensorList() {
    //Get coordinates.
    console.log("Getting coordinates...");
    const location = await Location.current();
    let lat = location.latitude;
    let lon = location.longitude;
    console.log(`lat: ${lat}, lon: ${lon}`);
    // Get nearest sensors list from current coordinates.
    console.log("Fetching nearest sensor list...");
    let deviceList = `${API_URL}device/nearest/lat/${lat}/lon/${lon}/`;
    let getSensorList = new Request(deviceList);
    let sensorList = await getSensorList.loadJSON();
    let sensors = sensorList.feeds;
    let ID = [];
    //Iterate JSON and store sensors in ID.
    for (let i = 0; i < sensors.length; i++) {
        const sensor = sensors[i];
        ID.push(Object.keys(sensor)[0]);
        console.log(`Sensor ${i+1}: ${Object.keys(sensor)[0]}`);
    }
    //Return first sensor, which is the nearest one.
    return ID[0];
}

//Get sensor data.
async function getSensorData() {
    //Load saved sensor or get nearest sensor ID from getSensorList().
    let device_id = await loadSensor() || await getSensorList();
    console.log(`Using sensor: ${device_id}`);
    let sensorData = new Request(`https://pm25.lass-net.org/data/last.php?device_id=${device_id}`);
    let raw = await sensorData.loadJSON();
    //Parse JSON.
    let data = raw.feeds[0].AirBox;
    //Return data in the form of JSON.
    return {
        temp: data.s_t0,
        RH: data.s_h0,
        pm25: data.s_d0,
        name: data.SiteName,
        timestamp: data.timestamp
    };
}

//Mapping the PM 2.5 levels with corresponding labels.
function getLevel(pm25) {
    let result = {
        threshold: "Getting data",
        label: "Calculating",
        startColor: "white",
        endColor: "white",
        textColor: "black",
    };
    if (pm25 <= 15) {
        return {
            threshold: 15,
            label: "良好",
            startColor: "00e400",
            endColor: "00bb00",
            textColor: "000000",
        };
    } else if (pm25 <= 35) {
        return {
            threshold: 35,
            label: "普通",
            startColor: "ffff00",
            endColor: "cccc00",
            textColor: "000000",
        };
    } else if (pm25 <= 54) {
        return {
            threshold: 54,
            label: "對敏感族群不健康",
            startColor: "FFA63D",
            endColor: "D67200",
            textColor: "000000",
        };
    } else if (pm25 <= 150) {
        return {
            threshold: 150,
            label: "不健康",
            startColor: "FF3D3D",
            endColor: "D60000",
            textColor: "000000",
        };
    } else if (pm25 <= 250) {
        return {
            threshold: 250,
            label: "非常不健康",
            startColor: "8f3f97",
            endColor: "6f1f77",
            textColor: "ffffff",
        };
    } else if (pm25 <= 999 || pm25 > 999) {
        return {
            threshold: 999,
            label: "有害",
            startColor: "9e2043",
            endColor: "7e0023",
            textColor: "ffffff",
        };
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
        let textColor = '112A46';
        console.log(level);

        let startColor = new Color(level.startColor);
        let endColor = new Color(level.endColor);
        let gradient = new LinearGradient({
            colors: [startColor, endColor],
            locations: [0, 1]
        });
        console.log(gradient);

        wg.backgoundGradient = gradient;
        wg.backgroundColor = new Color('F7F7F7');

        let header = wg.addText(`${level.label}`);
        header.textColor = new Color(textColor);
        header.font = Font.boldSystemFont(15);

        wg.addSpacer(10);

        let content = wg.addText(`粉塵 ${pm25} ug/m3`);
        content.textColor = new Color(textColor);
        content.font = Font.regularSystemFont(12);


        let wordTemp = wg.addText(`${temp} °C`);
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