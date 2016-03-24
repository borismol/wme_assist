// ==UserScript==
// @name WME_Assist_Analyzer
// @author borman84 (Boris Molodenkov)
// @description Waze Map Editor Assist Analyzer
// @match     https://world.waze.com/editor/*
// @match     https://*.waze.com/editor/*
// @match     https://*.waze.com/*/editor/*
// @match     https://world.waze.com/map-editor/*
// @match     https://world.waze.com/beta_editor/*
// @match     https://www.waze.com/map-editor/*
// @grant     none
// @include   https://editor-beta.waze.com/*
// @include   https://*.waze.com/editor/editor/*
// @include   https://*.waze.com/*/editor/*
// @version   0.5.0
// @namespace https://greasyfork.org/users/20609
// ==/UserScript==

var WME_Assist = WME_Assist || {}

WME_Assist.Analyzer = function (wazeapi) {
    var ActionHelper = function (wazeapi) {
        var WazeActionUpdateObject = require("Waze/Action/UpdateObject");
        var WazeActionAddOrGetStreet = require("Waze/Action/AddOrGetStreet");
        var WazeActionAddOrGetCity = require("Waze/Action/AddOrGetCity");

        var type2repo = function (type) {
            var map = {
                'venue': wazeapi.model.venues,
                'segment': wazeapi.model.segments
            };
            return map[type];
        }

        this.isObjectVisible = function (obj) {
            if (!onlyVisible) return true;
            if (obj.geometry)
                return wazeapi.map.getExtent().intersectsBounds(obj.geometry.getBounds());
            return false;
        }

        var addOrGetStreet = function (cityId, name, isEmpty) {
            var foundStreets = wazeapi.model.streets.getByAttributes({
                cityID: cityId,
                name: name,
            });

            if (foundStreets.length == 1)
                return foundStreets[0];

            var city = wazeapi.model.cities.objects[cityId];
            var a = new WazeActionAddOrGetStreet(name, city, isEmpty);
            wazeapi.model.actionManager.add(a);

            return a.street;
        }

        var addOrGetCity = function (countryID, stateID, cityName) {
            var foundCities = Waze.model.cities.getByAttributes({
                countryID: countryID,
                stateID: stateID,
                name : cityName
            });

            if (foundCities.length == 1)
                return foundCities[0];

            var state = Waze.model.states.objects[stateID];
            var country = Waze.model.countries.objects[countryID];
            var a = new WazeActionAddOrGetCity(state, country, cityName);
            Waze.model.actionManager.add(a);
            return a.city;
        }

        var cityMap = {};
        var onlyVisible = false;

        this.newCityID = function (id) {
            var newid = cityMap[id];
            if (newid) return newid;
            return id;
        }

        this.renameCity = function (oldname, newname) {
            var oldcity = wazeapi.model.cities.getByAttributes({name: oldname});

            if (oldcity.length == 0) {
                console.log('City not found: ' + oldname);
                return false;
            }

            var city = oldcity[0];
            var newcity = addOrGetCity(city.countryID, city.stateID, newname);

            cityMap[city.getID()] = newcity.getID();
            onlyVisible = true;

            console.log('Do not forget press reset button and re-enable script');
            return true;
        }

        var onIssueResolved = function () {}
        var onUserIssueFixed = function () {}
        var onIssueFixFailed = function () {}

        this.onIssueResolved = function (cb) {
            onIssueResolved = cb;
        }

        this.onUserIssueFixed = function (cb) {
            onUserIssueFixed = cb;
        }

        this.onIssueFixFailed = function (cb) {
            onIssueFixFailed = cb;
        }

        this.fixProblem = function (problem) {
            var attemptNum = 10; // after that we decide that object was removed

            var fix = function () {
                var obj = type2repo(problem.object.type).objects[problem.object.id];
                wazeapi.model.events.unregister('mergeend', map, fix);

                if (obj) {
                    // protect user manual fix
                    var currentValue = wazeapi.model.streets.objects[obj.attributes[problem.attrName]].name;
                    if (problem.reason == currentValue) {
                        var correctStreet = addOrGetStreet(problem.cityId, problem.newStreetName, problem.isEmpty);
                        var request = {};
                        request[problem.attrName] = correctStreet.getID();
                        wazeapi.model.actionManager.add(new WazeActionUpdateObject(obj, request));
                    } else {
                        onUserIssueFixed(problem.object.id, currentValue);
                    }

                    onIssueResolved(problem.object.id);
                } else if (--attemptNum <= 0) {
                    onIssueFixFailed(problem.object.id);
                    onIssueResolved(problem.object.id);
                } else {
                    wazeapi.model.events.register('mergeend', map, fix);
                    wazeapi.map.setCenter(problem.detectPos, problem.zoom);
                }

                WME_Assist.debug('Attempt number left: ' + attemptNum);
            }

            fix();
        }
    }

    var Exceptions = function () {
        var exceptions = [];

        var onAdd = function (name) {}
        var onDelete = function (index) {}

        var save = function (exception) {
            if (localStorage) {
                localStorage.setItem('assistExceptionsKey', JSON.stringify(exceptions));
            }
        }

        this.load = function () {
            if (localStorage) {
                var str = localStorage.getItem('assistExceptionsKey');
                if (str) {
                    var arr = JSON.parse(str);
                    for (var i = 0; i < arr.length; ++i) {
                        var exception = arr[i];
                        this.add(exception);
                    }
                }
            }
        }

        this.contains = function (name) {
            if (exceptions.indexOf(name) == -1) return false;
            return true;
        }

        this.add = function (name) {
            exceptions.push(name);
            save(exceptions);
            onAdd(name);
        }

        this.remove = function (index) {
            exceptions.splice(index, 1);
            save(exceptions);
            onDelete(index);
        }

        this.onAdd = function (cb) { onAdd = cb }
        this.onDelete = function (cb) {onDelete = cb }
    }

    var analyzedIds = [];
    var problems = [];
    var unresolvedIdx = 0;
    var skippedErrors = 0;
    var variant;
    var exceptions = new Exceptions();
    var action = new ActionHelper(wazeapi);
    var rules;

    var getUnresolvedErrorNum = function () {
        return problems.length - unresolvedIdx - skippedErrors;
    }

    var getFixedErrorNum = function () {
        return unresolvedIdx;
    }

    this.unresolvedErrorNum = getUnresolvedErrorNum;
    this.fixedErrorNum = getFixedErrorNum;

    this.setRules = function (r) {
        rules = r;
    }

    var onIssueResolved = function () {}

    this.onIssueResolved = function (cb) {
        onIssueResolved = cb;
    }

    this.onUserIssueFixed = function (cb) {
        action.onUserIssueFixed = cb;
    }

    this.onIssueFixFailed = function (cb) {
        action.onIssueFixFailed = cb;
    }

    this.loadExceptions = function () {
        exceptions.load();
    }

    this.onExceptionAdd = function (cb) {
        exceptions.onAdd(cb);
    }

    this.onExceptionDelete = function (cb) {
        exceptions.onDelete(cb);
    }

    this.addException = function (reason, cb) {
        exceptions.add(reason);

        var i;
        for (i = 0; i < problems.length; ++i) {
            var problem = problems[i];
            if (problem.reason == reason) {
                problem.skip = true;
                ++skippedErrors;

                cb(problem.object.id);
            }
        }
    }

    this.removeException = function (i) {
        exceptions.remove(i);
    }

    this.setVariant = function (v) {
        variant = v;
    }

    this.reset = function () {
        analyzedIds = [];
        problems = [];
        unresolvedIdx = 0;
        skippedErrors = 0;
    }

    this.fixAll = function (onAllIssuesFixed) {
        WME_Assist.series(problems, unresolvedIdx, function (p, next) {
            if (p.skip) {
                next();
                return;
            }

            action.onIssueResolved(function (id) {
                ++unresolvedIdx;
                onIssueResolved(id);

                setTimeout(next, 0);
            });

            action.fixProblem(p);
        }, onAllIssuesFixed);
    }

    var checkStreet = function (bounds, zoom, streets, streetID, obj, attrName, onProblemDetected) {
        var street = streets[streetID];

        if (!street) return;

        var detected = false;
        var title = '';
        var reason;

        if (!street.isEmpty) {
            if (!exceptions.contains(street.name)) {
                try {
                    var result = rules.correct(variant, street.name);
                    var newStreetName = result.value;
                    detected = (newStreetName != street.name);
                    if (obj.type == 'venue') title = 'POI: ';
                    title = title + street.name.replace(/\u00A0/g, '■').replace(/^\s|\s$/, '■') + ' ➤ ' + newStreetName;
                    reason = street.name;
                } catch (err) {
                    WME_Assist.warning('Street name "' + street.name + '" causes error in rules');
                    return;
                }
            }
        }

        var newCityID = street.cityID;
        // if (obj.type != 'segment') {
        //     newCityID = action.newCityID(street.cityID);
        //     if (newCityID != street.cityID) {
        //         detected = true;
        //         title = 'city: ' +
        //             wazeapi.model.cities.objects[street.cityID].name + ' -> ' +
        //             wazeapi.model.cities.objects[newCityID].name;
        //     }
        // }

        if (detected) {
            var gj = new OL.Format.GeoJSON();
            var geometry = gj.parseGeometry(obj.geometry);
            var objCenter = geometry.getBounds().getCenterLonLat().transform(wazeapi.controller.segmentProjection, wazeapi.map.getProjectionObject());
            var boundsCenter = bounds.clone().getCenterLonLat().transform(wazeapi.controller.segmentProjection, wazeapi.map.getProjectionObject());

            problems.push({
                object: obj,
                reason: reason,
                attrName: attrName,
                detectPos: boundsCenter,
                zoom: zoom,
                newStreetName: newStreetName,
                isEmpty: street.isEmpty,
                cityId: newCityID,
                experimental: false,
            });

            onProblemDetected(obj, title, reason, objCenter);
        }
    }

    this.analyze = function (bounds, zoom, data, onProblemDetected) {
        var permissions = new require("Waze/Permissions");
        var startTime = new Date().getTime();

        WME_Assist.info('start analyze');

        var subjects = {
            'segment': {
                attr: 'primaryStreetID',
                name: 'segments',
                permissions: permissions.Segments,
            },
            'venue': {
                attr: 'streetID',
                name: 'venues',
                permissions: permissions.Landmarks,
            }
        };

        for (var k in subjects) {
            var subject = subjects[k];
            var subjectData = data[subject.name];

            if (!subjectData) continue;

            var objects = subjectData.objects;

            for (var i = 0; i < objects.length; ++i) {
                var obj = objects[i];
                var id = obj.id;

                obj.type = k;

                if (analyzedIds.indexOf(id) >= 0) continue;

                if (!(obj.permissions & subject.permissions.EDIT_PROPERTIES)) continue;
                if (obj.hasClosures) continue;

                if (typeof obj.approved != 'undefined' && !obj.approved) continue;

                var streetID = obj[subject.attr];
                var streetDict = data.streets.objects.reduce(function (dict, street, i) {
                    dict[street.id] = street;
                    return dict;
                }, {});
                checkStreet(bounds, zoom, streetDict, streetID, obj, subject.attr, onProblemDetected);

                analyzedIds.push(id);
            }
        }

        WME_Assist.info('end analyze: ' + (new Date().getTime() - startTime) + 'ms');
    }
}
