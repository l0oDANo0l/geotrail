﻿'use strict';
/* Prototype for L.LatLng object in LeafLetJs provided by 
Gregor the Map Guy Blog
--------------------------------------------------------------
*/
// Returns bearing to other destination from this object.
// Arg:
//  other: L.LatLng object for the other destination.
// Returns:
//  bearing: floating point number in degrees for bearing wrt to North.
//           value constrainted to 0 to 360 degrees.
L.LatLng.prototype.bearingTo = function(other) {
    var d2r  = L.LatLng.DEG_TO_RAD;
    var r2d  = L.LatLng.RAD_TO_DEG;
    var lat1 = this.lat * d2r;
    var lat2 = other.lat * d2r;
    var dLon = (other.lng-this.lng) * d2r;
    var y    = Math.sin(dLon) * Math.cos(lat2);
    var x    = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
    var brng = Math.atan2(y, x);
    //brng = parseInt( brng * r2d ); // Use floating point for the bearing angle.
    brng = brng * r2d;
    brng = (brng + 360) % 360;
    return brng;
};

// Returns word abbreviation for bearing to other destination.
// Arg:
//  other: L.LatLng destination object.
// Returns:
//  word: string for abbreviation of compass bearing.
L.LatLng.prototype.bearingWordTo = function(other) {
    var bearing = this.bearingTo(other);
    var bearingword = '';
    if      (bearing >=  22 && bearing <=  67) bearingword = 'NE';
    else if (bearing >=  67 && bearing <= 112) bearingword =  'E';
    else if (bearing >= 112 && bearing <= 157) bearingword = 'SE';
    else if (bearing >= 157 && bearing <= 202) bearingword =  'S';
    else if (bearing >= 202 && bearing <= 247) bearingword = 'SW';
    else if (bearing >= 247 && bearing <= 292) bearingword =  'W';
    else if (bearing >= 292 && bearing <= 337) bearingword = 'NW';
    else if (bearing >= 337 || bearing <=  22) bearingword =  'N';
    return bearingword;
};

/* -------------------------------------------------------------------*/

// Object for showing geo path map.
// Object can be shared by view objects of pages, 
// for example GeoPaths.html and Trail.html.
// Constructor Arg:
//  bShowMapCtrls: boolean. Indicates if zoom and map-type controls are shown
//                 on google map. Defaults to false;
//                 Note: Ignored for now because zoom control always remains on
//                       top causing problem for Settings diaglog.
function wigo_ws_GeoPathMap(bShowMapCtrls) {
    var that = this;
    var map = null;     // Underlying map object.
    var mapPath = null; // Map overlay for current path.
    var tileLayer = null; // L.TileLayer.Cordova obj for caching map tiles offline.
    var zoomPathBounds = null; // Zoom value to fit trail to bounds of view.

    // Initialize to use Open Streets Map once browser has initialized.
    // Arg:
    //  callback: callback function called upon completion of loading map. 
    //      callback may be null. Signature of callback:
    //          bOk: boolean indicating success.
    //          sMsg: string for message. For bOk false, an error message.
    // Remarks: Event handler for window loaded can be set to this function.
    this.InitializeMap = function (callback) {
        console.log("Initializing Map.");
        var latlngMtHood = new L.LatLng(45.3736111111111, -121.695833333333);
        // Note: {zoomControl: false} is used for map options because the zoomControl
        //       always stays on top, which a problem when Setting dialog is opened.
        map = L.map('map-canvas', { zoomControl: false }).setView(latlngMtHood, 13);

        NewTileLayer(function (layer, sError) {
            tileLayer = layer;
            if (tileLayer)
                tileLayer.addTo(map);

            // Add a listener for the click event.
            map.on('click', onMapClick);
            // Callback to indicate the result.
            var bOk = tileLayer !== null;
            if (callback) {
                callback(bOk, sError);
            }
        });
    };


    // Error message that methods may set on an error.
    this.sError = "";

    var curPath = null; // Ref to current path drawn.
    // Draws geo path on the Google map object.
    // Args:
    //  path: wigo_ws_GpxPath object for the path.
    this.DrawPath = function (path) {
        if (!IsMapLoaded())
            return; // Quit if map has not been loaded.
        //var polyline = L.polyline(latlngs, { color: 'red' }).addTo(map);
        // Clear any current path before drawing another path.
        this.ClearPath();

        var pathCoords = new Array();
        var gpt;
        var mapCoord;
        for (var i = 0; i < path.arGeoPt.length; i++) {
            gpt = path.arGeoPt[i];
            mapCoord = L.latLng(gpt.lat, gpt.lon);
            pathCoords.push(mapCoord);
        }
        mapPath = L.polyline(pathCoords, { color: 'red', opacity: 1.0 });
        mapPath.addTo(map);
        // Set zoom so that trail fits.
        var sw = L.latLng(path.gptSW.lat, path.gptSW.lon);
        var ne = L.latLng(path.gptNE.lat, path.gptNE.lon);
        var bounds = L.latLngBounds(sw, ne);
        map.fitBounds(bounds);
        // Save zoom value to restore by this.PanToPathCenter().
        zoomPathBounds = map.getZoom();

        curPath = path; // Save current gpx path object.
        this.PanToPathCenter();
    };

    // Sets geo location circle and arrow for shortest distance to geo path.
    // Arg:
    //  location: Map LatLng object for location off the geo path.
    this.SetGeoLocationCircleAndArrow = function (location) {
        if (!IsMapLoaded())
            return; // Quit if map has not been loaded.
        // Draw geo location circle (green circle) on the map.
        SetGeoLocationCircle(location, 10);
        if (geolocCircle) {
            SetGeoLocToPathArrow(location);
            var center = geolocCircle.getLatLng();
            map.panTo(center);
        }
    };

    // Sets geo location update figures on map for shortest distance to geo path, 
    // but only if current location is off the geo path by a specified amount.
    // Note: Likely replaces this.SetGeoLocationCircleAndArrow(location). Drawing
    //       is a bit different and previous geo point in addition to current geo point 
    //       are used to draw the figures.
    // Arg:
    //  location: Map LatLng object for current location off the geo path.
    //  dOffPath: float for distance from location off-path to on-path for which 
    //      valid result is returned.
    // Returns {bToPath: boolean, dToPath: float, bearingToPath: float, bRefLine: boolean, bearingRefLine: float}:
    //  bToPath indicates path from geo location off path to nearest location on the path is valid.
    //      For bToPath false, dToPath and bearingToPath are invalid.
    //      Distance from location off-path to on-path must be > arg dOffPath for 
    //      bToPath to be true.
    //  dToPath: distance in meters from off-path location to on-path location.
    //  bearingToPath is bearing (y-North cw) in degrees (0.0 to 360.0) for location to 
    //      nearest point on the path.
    //  bRefLine indicates bearingRefLine is valid.
    //  bearingRefLine is bearing (y-North cw) in degrees (0.0 to 360.0) for reference 
    //  line from previous off-path location to current off-path location.
    // Remarks:
    //  The difference between bearingToPath and bearingRefLine may be useful for suggesting
    //  degrees of correction to navigate back to the path (trail).
    this.SetGeoLocationUpdate = function (location, dOffPath) {
        var result = { bToPath: false, bearingToPath: 0.0, dToPath: 0.0, bRefLine: false, bearingRefLine: 0.0 };
        if (!IsMapLoaded())
            return result; // Quit if map has not been loaded.

        // Set flag for initial update, which is used to avoid miss leading off-path
        // message when there is no previous geo location point.
        var bInitialUpdate = prevGeoLoc === null || prevGeoLocCircle === null;

        // Check if current location is sufficiently beyond previous location to 
        // use reference line from previous location.
        // Ensure prevGeoLoc and prevGeoLocCircle are initialized.
        if (prevGeoLoc === null)
            prevGeoLoc = location;
        if (prevGeoLocCircle === null)
            prevGeoLocCircle = L.circle(location, 1);
        var bCurGeoLocBeyondPrevGeoLoc = (location.distanceTo(prevGeoLoc) > this.dPrevGeoLocThres);

        var rCircle = 10; // Radius of circle in pixels
        var atPath = FindNearestPointOnGeoPath(location);
        if (atPath.llAt && atPath.d > dOffPath) {
            // Draw geo location circle (green circle) on the map.
            var llPathGeoLoc = null;
            SetGeoLocationCircle(location, rCircle);
            if (geolocCircle) {
                // Draw line from current geo location to nearest point on trail.
                DrawGeoLocToPathArrow(location, atPath.llAt);
                // Get bearing for navigating back to path.
                result.bearingToPath = location.bearingTo(atPath.llAt);
                result.dToPath = atPath.d; // Distance from point off path to the path.
                result.bToPath = true;
            }
            // Draw previous geolocation circle and reference line to current location.
            if (!bCurGeoLocBeyondPrevGeoLoc)
            {
                // Previous location is too close to current location.
                result.bearingRefLine = SetPrevGeoLocRefLine(prevGeoLocCircle.getLatLng(), rCircle);
                result.bRefLine = !bInitialUpdate;
            } else {
                result.bearingRefLine = SetPrevGeoLocRefLine(prevGeoLoc, rCircle);
                result.bRefLine = !bInitialUpdate;
            }

            // Pan map to current geo location.
            var center = geolocCircle.getLatLng();
            map.panTo(center);
        } else {
            // Clear previous off path drawings.
            this.ClearGeoLocationUpdate();
            // Draw the current geo-location circle only.
            SetGeoLocationCircle(location, rCircle);
            map.panTo(location); 
        }

        // Save current location as previous location for next update, provided
        // location has changed suffiently from previous location.
        if (bCurGeoLocBeyondPrevGeoLoc)
            prevGeoLoc = location;

        return result;
    };
    
    // Clears geo location update figures from the map. The path remains.
    this.ClearGeoLocationUpdate = function () {
        if (!IsMapLoaded())
            return; // Quit if map has not been loaded.
        ClearGeoLocationCircle();
        ClearGeoLocationToPathArrow();
        ClearPrevGeoLocRefLine();
    };

    // Pan to point on the map.
    // Arg:
    // gpt: wigo_ws_GeoPt obj to which to pan. 
    this.PanTo = function (gpt) {
        if (!IsMapLoaded())
            return; // Quit if map has not been loaded.
        var ll = L.latLng(gpt.lat, gpt.lon);
        map.panTo(ll);
    };

    // Pan to center of path on the map.
    // Returns true for success, false if current path is null.
    this.PanToPathCenter = function () {
        var bOk = true;
        if (curPath) {
            var gpt = curPath.gptCenter();
            this.PanTo(gpt);
            // Zoom to bounds that was saved when path was drawn.
            if (zoomPathBounds !== null) {
                map.setZoom(zoomPathBounds);
            }
        } else
            bOk = false;
        return bOk;
    };

    // Clears current path and geo location circle and arrow from the map.
    this.ClearPath = function () {
        if (!IsMapLoaded())
            return; // Quit if map has not been loaded.
        if (mapPath) {
            map.removeLayer(mapPath);
            mapPath = null;
        }
        curPath = null; 
        ClearGeoLocationCircle();
        ClearGeoLocationToPathArrow();
        ClearPrevGeoLocRefLine();
    }

    // Returns true if a path has been defined (drawn) for the map.
    this.IsPathDefined = function () {
        var bDefined = mapPath !== null;
        return bDefined;
    }

    // Caches current map view to the offline cache.
    // Arg:
    //  onStatusUpdate: callback for status update. Maybe null. callback signature:
    //    arg object {sMsg: string, bDone: boolean, bError: boolean}: 
    //      sMsg: Status msg.
    //      bDone: Indicates done, no more callbacks.
    //      bError: Indicates an error.
    // Returns:
    //  boolean, true indicates success. Return is immediate but download of tiles is
    //  asynchronous. onStatusUpdate(arg) callback is done (repeatedly) to update status
    //  asyncrhonously.
    this.CacheMap = function (onStatusUpdate) {
        CacheLayer(onStatusUpdate);
    };

    // Sets map for offline or online use.
    // Arg:
    //  bOffline: boolean indicates using map online.
    // Return result object, {bOk: boolean, sMsg: string}:
    //  bOk indicates success.
    //  sMsg is an error message for bOk false, or an empty string for bOk true.
    this.GoOffline = function (bOffline) {
        var result = {bOk: true, sMsg: ""};
        if (tileLayer) {
            if (bOffline)
                tileLayer.goOffline();
            else
                tileLayer.goOnline();
        } else {
            result.bOk = false;
            var sOnOffline = bOffline ? "offline." : "online.";
            result.sMsg = "Failed to prepare for using map " + sOnOffline;
        }
        return result;
    };

    // Returns a reference to underlaying Google map object.
    this.getMap = function () { return map; };

    // Returns word abbreviation for bearing to other destination.
    // Arg:
    //  bearing: float in degrees for compass bearing, 0 .. 360.
    // Returns:
    //  word: string for abbreviation of compass bearing.
    this.BearingWordTo = function (bearing) {
        var bearingword = '';
        if (bearing >= 22 && bearing <= 67) bearingword = 'NE';
        else if (bearing >= 67 && bearing <= 112) bearingword = 'E';
        else if (bearing >= 112 && bearing <= 157) bearingword = 'SE';
        else if (bearing >= 157 && bearing <= 202) bearingword = 'S';
        else if (bearing >= 202 && bearing <= 247) bearingword = 'SW';
        else if (bearing >= 247 && bearing <= 292) bearingword = 'W';
        else if (bearing >= 292 && bearing <= 337) bearingword = 'NW';
        else if (bearing >= 337 || bearing <= 22) bearingword = 'N';
        return bearingword;
    };

    // Distance in meters for changing previous geo-location wrt current geo-location.
    // Note: Parameter for updating prevGeoLocCircle when current location changes.
    this.dPrevGeoLocThres = 10.0;

    // For debug, a mouse click (touch) on the map can simulate a geo-location.
    // Boolean to indicate mouse clicks are ignored.
    this.bIgnoreMapClick = true;

    // ** Events fired by map for container (view) to handle.
    // Click current on the map.
    // Signature of handler:
    //  llAt: Google LatLng object for the click.
    this.onMapClick = function (llAt) { };

    // Event handler for click on map.
    function onMapClick(e) {
        // Note: Only fires event for debug. Normally ignores a click.
        if (that.onMapClick && !that.bIgnoreMapClick)
            that.onMapClick(e.latlng);
    }

    // ** More private members

    // Returns true if map is loaded.
    // For false, sets this.sError to indicate map is not loaded.
    function IsMapLoaded() {
        var bYes = map != null;
        return bYes;
    }

    // Clears from map the geo location circle.
    function ClearGeoLocationCircle() {
        // Remove existing geolocation circle, if there is one, from the map.
        if (geolocCircle)
            map.removeLayer(geolocCircle);    }

    var geolocCircle = null;
    // Set (draws) circle on map centered at geo location.
    // Arguments:
    //  latlng is L.LatLng object for center of circle.
    //  r is radius in meters of circle.
    function SetGeoLocationCircle(latlng, r) {
        ClearGeoLocationCircle();
        var circleOptions = {
            color: '#00FF00',
            opacity: 1.0,
            fill: true,
            fillOpacity: 1.0,
            weight: 5
        };
        geolocCircle = L.circle(latlng, r, circleOptions);
        geolocCircle.addTo(map);
    }

    var curLocToPathArrow = null; // Current arrow from location to path drawn on map.
    // Clears from map the current location to geo path arrow.
    function ClearGeoLocationToPathArrow() {
        // Remove existing geolocation to path arrow, if there is one, from the map.
        if (curLocToPathArrow)
            map.removeLayer(curLocToPathArrow);
    }

    // Sets (draws) arrow for a location to nearest point on geo path (the trail).
    // Arg:
    //  location: Map L.LatLng object for location on map.
    // Returns {llAt: L.LatLng, d: float}:
    //  llAt is lat/lng of nearest geo point found on the path. null if not found.
    //  d is distance in meters to nearest point on the path.
    function SetGeoLocToPathArrow(location) {
        var found = FindNearestPointOnGeoPath(location);
        if (found.llAt) {
            DrawGeoLocToPathArrow(location, found.llAt);
        }
        return found;
    }


    // Draws arrow for a location off geo path to point on geo path (the trail).
    // Arg:
    //  location: Map L.LatLng object for location on map.
    //  llAt: point on the geo path.
    // Remarks:
    // Actually draws facsimile of an arrow using a line with a rounded end.
    // The line is between any two points, but the purpose is likely to draw the 
    // line from a point off the geo path to a point on the geo path.
    function DrawGeoLocToPathArrow(location, llAt) {
        ClearGeoLocationToPathArrow();

        var mapCoords = [location, llAt];
        var options = {
            color: '#0000FF',
            lineCap: 'butt',  /* in place of an arrow */
            weight: 5,
            opacity: 1.0
        }
        var mapPath = L.polyline(mapCoords, options)
        mapPath.addTo(map);
        // Note: Leaflet has no easy way to put arrow on polylines.
        // Save ref to the current path.
        curLocToPathArrow = mapPath;
    }

    var prevGeoLoc = null;       // geo-location of previous geo-location update. 
    var prevGeoLocCircle = null; // L.Circle object for previous geo-location.
    var prevGeoLocRefLine = null;// L.Polyline object for reference line though geolocCircle and preGeoLocCircle.
    
    // Clears from map the previous geo location reference line.
    function ClearPrevGeoLocRefLine() {
        if (prevGeoLocCircle)
            map.removeLayer(prevGeoLocCircle);
        if (prevGeoLocRefLine)
            map.removeLayer(prevGeoLocRefLine);
    }

    // Sets (draws) reference line through prevGeoLocCircle and (current) geolocCircle.
    // Also draws the previous geolocation circle.
    // Arg:
    //  location: Map L.LatLng object for previous location on map.
    //  r: integer for radius of previous location circle in pixels.
    // Returns bearing (y-North cw in degrees) of reference line.
    function SetPrevGeoLocRefLine(prevLocation, r) {
        ClearPrevGeoLocRefLine();
        // Current geolocCircle must exist.
        if (!geolocCircle)
            return 0.0;
        // Draw circle for previous geo-location.
        var circleOptions = {
            color: '#00FFFF',
            opacity: 1.0,
            fill: true,
            fillOpacity: 1.0,
            weight: 5
        };
        prevGeoLocCircle = L.circle(prevLocation, r, circleOptions);
        prevGeoLocCircle.addTo(map);

        // Draw thin reference line from previous geo-location thru current geo-location.
        var llTo = geolocCircle.getLatLng();
        var dest = ExtendLine(prevLocation, llTo, 30); // Extend end point of reference line by 30 meters.
        var mapCoords = [prevLocation, dest.at];
        var options = {
            color: '#000000',
            weight: 2,
            opacity: 1.0
        }
        prevGeoLocRefLine = L.polyline(mapCoords, options)
        prevGeoLocRefLine.addTo(map);
        return dest.bearing;
    }

    // Determines heading of line and extends line by a given delta.
    // Args:
    //  llFrom: L.LatLng object for from geo-location.
    //  llTo: L.LatLng for to geo-location.
    //  delta: float for number of meters to extend line in direction of bearing
    //         beyond llTo.
    //         Currently delta is ignored. Works pretty good without extending line.
    // Returns object {at: L.LatLng, bearing: float}:
    //  at is lat/lng of end point of extended line.
    //  bearing (cc wrt North) is in degrees for the extended line.
    function ExtendLine(llFrom, llTo, delta) {
        var dest = { at: L.latLng(llTo.lat, llTo.lng), bearing: 0 };
        dest.bearing = llFrom.bearingTo(llTo);
        return dest;
        /* // Maybe change later. Extension is not correct. Works pretty good without extension.
        // Convert angle from degrees to radian and translate
        // from bearing of y-North cw to Y-North ccw to be
        // consistent with trig unit circle.
        var theta = (90.0 - dest.bearing) * L.LatLng.DEG_TO_RAD;
        var deltaLat = delta * Math.cos(theta);
        var deltaLng = delta * Math.sin(theta);
        //Oops deltaLat, deltaLng above are meters, need to convert to degrees. Haversine functions probably have this.
        //This following would work but have not tried yet:
        //      From s = r * theta for arc of circle.
        //      R is radius of earth.
        //      deltaLng = (deltaLng as s) / R.
        //      r at latitude = R*cos(Lng).
        //      deltaLat = (deltaLat as s) / (R*cos(Lng).
        dest.at.lat  += deltaLat;
        dest.at.lng += deltaLng;
        return dest;
        */
    }

    // Searchs through all segments of curPath to find shortest distance
    // to the path from a location off the path.
    // Returns {llAt: L.LatLng, d: float}:
    //  llAt is lat/lng of nearest geo point found on the path. null if not found.
    //  d is distance in meters to nearest point on the path.
    // Arg: 
    //      llLoc: Map L.LatLng object for location for which search is done.
    function FindNearestPointOnGeoPath(llLoc) {
        var minD = 0.0;
        var llFound = null;
        if (curPath && curPath.arGeoPt) {
            var result;
            var llSeg0, llSeg1, gpt, gptNext;
            for (var i = 0; i < curPath.arGeoPt.length; i++) {
                gpt = curPath.arGeoPt[i];
                llSeg0 = L.latLng(gpt.lat, gpt.lon);
                if (curPath.arGeoPt.length == 1) {
                    llFound = llSeg0;
                } else if (i < curPath.arGeoPt.length - 1) {
                    gptNext = curPath.arGeoPt[i + 1];
                    llSeg1 = L.latLng(gptNext.lat, gptNext.lon);
                    result = LocationToSegment(llLoc, llSeg0, llSeg1);
                    if (llFound === null) {
                        llFound = result.at;
                        minD = result.d;
                    } else if (result.d < minD) {
                        llFound = result.at;
                        minD = result.d;
                    }
                }
            }
        }
        var found = { llAt: llFound, d: minD };
        return found;
    }

    // Calculates distance from a location point to a line segment.
    // Returns literal object:
    //  d: floating point number for distance to path in meters.
    // llAt: L.LatLng object for point on the segment.
    // Args:
    //  llLoc: L.LatLng object for location.
    //  llSeg0: L.LatLng object for starting point of segment.
    //  llSeg1: L.LatLng object for ending point of segment.
    function LocationToSegment(llLoc, llSeg0, llSeg1) {
        var hdLoc = llSeg0.bearingTo(llLoc);
        var dLoc = llSeg0.distanceTo(llLoc);
        var hdSeg = llSeg0.bearingTo(llSeg1);
        var dSeg = llSeg0.distanceTo(llSeg1);

        // Calc angle phi between heading hdLoc and heading hdSeg.
        var phi = hdSeg - hdLoc;
        if (phi < 0)
            phi = -phi;
        phi = phi * L.LatLng.DEG_TO_RAD;  // Convert degrees to radians.

        // I think simple planar geometry approx for interpolation should be good enough.
        var llAt = L.latLng(0,0);
        var dOnSeg = dLoc * Math.cos(phi);
        if (dOnSeg < 0.0) {
            // Vector location projects before starting point of segment, so
            // truncate to starting point of the segment.
            llAt = llSeg0;
        } else if (dOnSeg > dSeg) {
            // Vector to location point projects beyong segment, so truncate 
            // to segment end point.
            llAt = llSeg1;
        } else {
            // Vector to location point projects onto segment.
            var fraction = dOnSeg / dSeg;
            var delLng = fraction * (llSeg1.lng - llSeg0.lng);
            var delLat = fraction * (llSeg1.lat - llSeg0.lat);
            llAt.lng = llSeg0.lng + delLng;
            llAt.lat = llSeg0.lat + delLat;
        }

        // Calculate distance from location to path.
        var dToPath = llLoc.distanceTo(llAt);
        var result = { d: dToPath, at: llAt };
        return result;
    }

    // ** More Private members related to caching map tiles.
    var CACHE_ZOOM_MAX = 16;

    // Creates a new L.TileLayer.Cordova object that can cache map tiles for trails.
    // The object is used for caching map tiles.
    // Arg:
    //  callback: callback called asynchronously to indicate result. 
    //      callback may be null or undefined. Signature of callback:
    //          layer: the L.TileLayer.Cordova object for caching map tiles.
    //              layer is null if it cannot be created.
    //          sMsg: string for a message. Is an error message when layer is null.
    function NewTileLayer(callback) {
        var layer = null;
        var sMsg = "";
        var bOk = false;
        var msRetryWait = 500; // Milliseconds to wait before retrying.
        var nTries = 3;
        var iTry = 0;
        var timerId = null;

        // Local helper function to NewTileLayer(callback).
        function CreateTileLayer() {
            iTry++;
            try {
                console.log("Creating L.TileLayer.Cordova.");
                layer = L.tileLayerCordova('https://{s}.tiles.mapbox.com/v3/examples.map-i875mjb7/{z}/{x}/{y}.png', {
                    // these options are perfectly ordinary L.TileLayer options
                    maxZoom: 18,
                    attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, ' +
                                    '<a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, ' +
                                    'Imagery © <a href="http://mapbox.com">Mapbox</a>',
                    // these are specific to L.TileLayer.Cordova and mostly specify where to store the tiles on disk
                    folder: 'WigoWsGeoTrail',
                    name: 'Trail',
                    debug: true
                });
                sMsg = "TileLayer created on try " + iTry.toString() + ".";
                bOk = true;
            } catch (e) {
                sMsg = e;
                bOk = false;
                layer = null;
            }
        }

        // First try to create tile layer.
        CreateTileLayer();
        if (bOk) {
            // Suceeded on first try.
            if (callback)
                callback(layer, sMsg);
        } else {
            // Failed on first try. Use interval timer to retry more times.
            timerId = window.setInterval(function () {
                if (iTry < nTries) {
                    bOk = CreateTileLayer();
                    if (bOk) {
                        // Successfully created tile layer.
                        window.clearInterval(timerId); // Stop interval timer.
                        if (callback)
                            callback(layer, sMsg);
                    }
                } else {
                    // Failed after nTries, so quit trying.
                    window.clearInterval(timerId); // Stop timer.
                    if (callback)
                        callback(layer, sMsg);
                }
            }, msRetryWait);
        }
    }

    // Caches a layer of map tiles locally to the device.
    // Args
    //  layer: L.TileLayer.Cordova of the layer to cache.
    //  onStatusUpdate: callback for status update. Maybe null. callback signature:
    //    arg object {sMsg: string, bDone: boolean, bError: boolean}: 
    //      sMsg: Status msg.
    //      bDone: Indicates done, no more callbacks.
    //      bError: Indicates an error.
    // Returns:
    //  boolean, true indicates success. Return is immediate but download of tiles is
    //  asynchronous. onStatusUpdate(arg) is called (repeatedly) to update download progress 
    //  asynchronously.
    function CacheLayer(onStatusUpdate) {
        var status = { sMsg: "", bDone: false, bError: false };
        if (!map || !tileLayer) {
            status.sMsg = "Map is not loaded yet.";
            status.bError = true;
            status.bDone = true;
            if (onStatusUpdate)
                onStatusUpdate(status);
            return false; // Quit if map does not exist yet.
        }

        var padPercent = 20.0; // Percentage on each side of current map view to 
                               // extend boundaries for caching tiles.
        var lat = map.getCenter().lat;
        var lng = map.getCenter().lng;
        var zmin = map.getZoom();
        var zmax = CACHE_ZOOM_MAX;
        var bounds = map.getBounds();
        bounds.pad(padPercent);
        var tile_list = tileLayer.calculateXYZListFromBounds(bounds, zmin, zmax);
        var message = "Preparing to cache tiles.\n" + "Zoom level " + zmin + " through " + zmax + "\n" + tile_list.length + " tiles total." + "\nClick OK to proceed.";
        var ok = confirm(message);
        if (!ok) return false;

        tileLayer.downloadXYZList(
            // 1st param: a list of XYZ objects indicating tiles to download
            tile_list,
            // 2nd param: overwrite existing tiles on disk? if no then a tile already on disk will be kept, which can be a big time saver
            false,
            // 3rd param: progress callback
            // receives the number of tiles downloaded and the number of tiles total; caller can calculate a percentage, update progress bar, etc.
            function (done, total) {
                var percent = Math.round(100 * done / total);
                status.sMsg = done + " / " + total + " = " + percent + "%";
                if (onStatusUpdate)
                    onStatusUpdate(status); 
            },
            // 4th param: complete callback
            // no parameters are given, but we know we're done!
            function () {
                // for this demo, on success we use another L.TileLayer.Cordova feature and show the disk usage
                tileLayer.getDiskUsage(function (filecount, bytes) {
                    var kilobytes = Math.round(bytes / 1024);
                    status.sMsg = "Map caching completed, status" + "<br/>" + filecount + " files" + "<br/>" + kilobytes + " kB";
                    status.bDone = true;
                    if (onStatusUpdate)
                        onStatusUpdate(status); 
                });
            },
            // 5th param: error callback
            // parameter is the error message string
            function (error) {
                status.sMsg = "Failed to cache map.<br/>Error code: " + error.code;
                status.bDone = true;
                status.bError = true;
                if (onStatusUpdate)
                    onStatusUpdate(status); 
            }
        );
        status.sMsg = "Starting download of map tiles for caching.";
        if (onStatusUpdate)
            onStatusUpdate(status);
        return true;
    }
}

