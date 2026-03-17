// DOM Elements
const appContainer = document.getElementById('app');
const toggleDisasterBtn = document.getElementById('toggle-disaster-btn');
const closeDisasterBtn = document.getElementById('close-disaster-btn');
const searchInput = document.getElementById('location-search');
const eventListContainer = document.getElementById('event-list-container');

// Coordinates for Bhopal
const defaultCoords = [23.2599, 77.4126];

// --- MAP INITIALIZATION ---
// 1. Initialize Main Map FIRST
const mainMap = L.map('main-map').setView(defaultCoords, 10);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
}).addTo(mainMap);

// Create a draggable pin on the main map
let weatherMarker = L.marker(defaultCoords, { draggable: true }).addTo(mainMap);

// 2. Initialize Disaster Map
const disasterMap = L.map('disaster-map').setView(defaultCoords, 2);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri'
}).addTo(disasterMap);


// --- REVERSE GEOCODING (Coordinates to City Name) ---
async function getCityName(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10`);
        const data = await res.json();
        
        if (data && data.address) {
            const city = data.address.city || data.address.town || data.address.village || data.address.county || data.address.state || "Unknown Region";
            const country = data.address.country || "";
            return `${city}, ${country} | Lat: ${lat.toFixed(2)}, Lng: ${lng.toFixed(2)}`;
        }
    } catch (error) {
        console.error("Reverse geocoding error:", error);
    }
    return `Lat: ${lat.toFixed(2)}, Lng: ${lng.toFixed(2)}`;
}


// --- WEATHER ENGINE ---
async function fetchWeatherData(lat, lng, locationName = "Selected Location") {
    try {
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,uv_index`);
        const weatherData = await weatherRes.json();
        
        const aqiRes = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi`);
        const aqiData = await aqiRes.json();

        document.getElementById('loc-name').innerText = locationName;
        document.getElementById('temp-val').innerText = `${Math.round(weatherData.current.temperature_2m)}°C`;
        document.getElementById('feels-like').innerText = `${Math.round(weatherData.current.apparent_temperature)}°C`;
        document.getElementById('wind-val').innerText = `${weatherData.current.wind_speed_10m} km/h`;
        document.getElementById('humidity-val').innerText = `${weatherData.current.relative_humidity_2m}%`;
        document.getElementById('uv-val').innerText = weatherData.current.uv_index || 0;
        
        const aqi = aqiData.current.us_aqi;
        document.getElementById('aqi-val').innerText = aqi;
        document.getElementById('aqi-desc').innerText = aqi > 100 ? "Unhealthy" : (aqi > 50 ? "Moderate" : "Good");
        document.getElementById('weather-desc').innerHTML = `<i class="fa-solid fa-cloud-sun"></i> Updated`;

    } catch (error) {
        console.error("Error fetching weather:", error);
    }
}

// Map Click Listener
mainMap.on('click', async function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    
    weatherMarker.setLatLng([lat, lng]); 
    mainMap.setView([lat, lng]); 
    
    document.getElementById('loc-name').innerText = "Locating...";
    
    const locationString = await getCityName(lat, lng);
    fetchWeatherData(lat, lng, locationString);
});

// Search Bar Listener (Geocoding)
searchInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value;
        try {
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${query}&count=1`);
            const geoData = await geoRes.json();
            if (geoData.results) {
                const loc = geoData.results[0];
                weatherMarker.setLatLng([loc.latitude, loc.longitude]);
                mainMap.flyTo([loc.latitude, loc.longitude], 10);
                
                const locationString = `${loc.name}, ${loc.country} | Lat: ${loc.latitude.toFixed(2)}, Lng: ${loc.longitude.toFixed(2)}`;
                fetchWeatherData(loc.latitude, loc.longitude, locationString);
            }
        } catch (error) {
            console.error("Error searching location:", error);
        }
    }
});


// --- DISASTER ENGINE ---
let disasterLayer = L.layerGroup().addTo(disasterMap);

async function fetchDisasters() {
    try {
        eventListContainer.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">Loading global events...</p>'; 
        disasterLayer.clearLayers();

        const [eqRes, volRes] = await Promise.all([
            fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson'),
            fetch('https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open')
        ]);
        
        const eqData = await eqRes.json();
        const volData = await volRes.json();
        
        let combinedEvents = [];

        // Get top 10 recent earthquakes
        const quakes = eqData.features.slice(0, 10);
        quakes.forEach(quake => {
            combinedEvents.push({
                type: 'earthquake',
                time: new Date(quake.properties.time), 
                title: `Magnitude ${quake.properties.mag.toFixed(1)}`,
                desc: quake.properties.place,
                lat: quake.geometry.coordinates[1],
                lng: quake.geometry.coordinates[0],
                hasTsunami: quake.properties.tsunami === 1
            });
        });

        // Get top 5 active volcanoes
        const volcanoes = volData.events.slice(0, 5);
        volcanoes.forEach(vol => {
            // NASA nests multiple updates in the geometry array. We want the most recent one (the last item).
            const latestUpdate = vol.geometry[vol.geometry.length - 1];
            
            combinedEvents.push({
                type: 'volcano',
                time: new Date(latestUpdate.date), 
                title: 'Active Eruption',
                desc: vol.title,
                lat: latestUpdate.coordinates[1],
                lng: latestUpdate.coordinates[0],
                hasTsunami: false
            });
        });

        // Sort combined list (Latest to Earliest)
        combinedEvents.sort((a, b) => b.time - a.time);

        eventListContainer.innerHTML = ''; 
        
        // Render ALL 15 events (10 quakes + 5 volcanoes) instead of slicing them out
        combinedEvents.forEach(event => {
            const timeString = event.time.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
            const pin = L.marker([event.lat, event.lng]).addTo(disasterLayer);
            
            const item = document.createElement('div');
            item.className = `event-item ${event.type} clickable-event`;

            if (event.type === 'earthquake') {
                pin.bindPopup(`<b>${event.title}</b><br>${event.desc}<br>${timeString}`);
                const tsunamiBadge = event.hasTsunami 
                    ? `<span style="color: var(--danger); font-size: 0.8rem; font-weight: 600; display: block; margin-top: 5px;">
                        <i class="fa-solid fa-water"></i> Tsunami Warning Issued
                       </span>` 
                    : '';

                item.innerHTML = `
                    <i class="fa-solid fa-house-crack"></i>
                    <div class="event-details">
                        <h4>${event.title}</h4>
                        <p>${event.desc}</p>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">${timeString}</p>
                        ${tsunamiBadge}
                    </div>
                `;
            } else if (event.type === 'volcano') {
                pin.bindPopup(`<b>Volcano Alert</b><br>${event.desc}<br>Last Update: ${timeString}`);
                item.innerHTML = `
                    <i class="fa-solid fa-volcano"></i>
                    <div class="event-details">
                        <h4>${event.title}</h4>
                        <p>${event.desc}</p>
                        <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">Update: ${timeString}</p>
                    </div>
                `;
            }
            
            item.addEventListener('click', () => {
                disasterMap.flyTo([event.lat, event.lng], 6, { animate: true, duration: 1.5 });
                pin.openPopup(); 
            });

            eventListContainer.appendChild(item);
        });

    } catch (error) {
        console.error("Error fetching disasters:", error);
        eventListContainer.innerHTML = '<p style="color: var(--danger); padding: 20px;">Failed to load event data.</p>';
    }
}


// --- UI INTERACTIONS & INIT ---
toggleDisasterBtn.addEventListener('click', () => {
    appContainer.classList.toggle('split-active');
    setTimeout(() => {
        mainMap.invalidateSize();
        disasterMap.invalidateSize();
    }, 400); 
});

closeDisasterBtn.addEventListener('click', () => {
    appContainer.classList.remove('split-active');
    setTimeout(() => mainMap.invalidateSize(), 400);
});

// Run Initial Data Fetches
fetchWeatherData(defaultCoords[0], defaultCoords[1], `Bhopal, Madhya Pradesh | Lat: 23.26, Lng: 77.41`);
fetchDisasters();