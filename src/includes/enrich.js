    (function(){
        /**
         * Methods related to enrichment functionality
         */

        var dadataConfig = {
            url: 'https://dadata.ru/api/v2/clean-suggestion',
            timeout: 1000
        };

        var enrichServices = {
            'default': {
                enrichSuggestion: function (suggestion) {
                    return $.Deferred().resolve(suggestion);
                },
                enrichResponse: function (response, query, fnProcess) {
                    return $.Deferred().resolve(response);
                }
            },
            'dadata': (function () {
                var fieldParsers = {};

                /**
                 * Values of `gender` from dadata.ru differ from ones in original suggestions
                 * @param value
                 * @returns {{gender: string}}
                 */
                fieldParsers.gender = function (value) {
                    return {
                        gender: value == 'М' ? 'MALE' :
                            value == 'Ж' ? 'FEMALE' : 'UNKNOWN'
                    }
                };

                function startRequest(query) {
                    var that = this,
                        token = $.trim(that.options.token),
                        data = {
                            structure: [that.options.type],
                            data: [
                                [ query ]
                            ]
                        },
                        url = dadataConfig.url,
                        params = {
                            type: 'POST',
                            contentType: 'application/json',
                            dataType: 'json',
                            data: JSON.stringify(data),
                            timeout: dadataConfig.timeout
                        },
                        checksum = utils.checksum(query + ':' + token);

                    url = utils.fixURLProtocol(url);

                    if ($.support.cors) {
                        // for XMLHttpRequest put token in header
                        params.headers = {
                            'Authorization': 'Token ' + token,
                            'X-Checksum': checksum
                        }
                    } else {
                        // for XDomainRequest put token into URL
                        url = utils.addUrlParams(url, {
                            'token': token,
                            'checksum': checksum
                        });
                    }

                    that.currentEnrichRequest = $.ajax(url, params);
                    return that.currentEnrichRequest.always(function(){
                        that.currentEnrichRequest = null;
                    });
                }

                function shouldOverrideField(field, data) {
                    return !(field in data) || field === 'house' || (field === 'okato' && !data[field]);
                }

                return {
                    enrichSuggestion: function (suggestion) {
                        var that = this,
                            resolver = $.Deferred();

                        // if current suggestion is from dadata, use it
                        if (suggestion.data && 'qc' in suggestion.data) {
                            return resolver.resolve(suggestion);
                        }

                        that.showPreloader();
                        that.disableDropdown();
                        startRequest.call(that, suggestion.unrestricted_value)
                            .always(function () {
                                that.hidePreloader();
                                that.enableDropdown();
                            })
                            .done(function (resp) {
                                var data = resp.data,
                                    s = data && data[0] && data[0][0];

                                if (s) {
                                    if (!suggestion.data) {
                                        suggestion.data = {};
                                    }
                                    if (s.qc === 0) {
                                        // should enrich suggestion only if Dadata returned good qc
                                        delete s.source;
                                        $.each(s, function (field, value) {
                                            if (shouldOverrideField(field, suggestion.data)) {
                                                var parser = fieldParsers[field];
                                                if (parser) {
                                                    $.extend(suggestion.data, parser(value))
                                                } else {
                                                    suggestion.data[field] = value;
                                                }
                                            }
                                        });
                                    } else {
                                        // but even if qc is bad, should add it to suggestion object
                                        suggestion.data.qc = s.qc;
                                        if ('qc_complete' in s) {
                                            suggestion.data.qc_complete = s.qc_complete;
                                        }
                                    }
                                }

                                resolver.resolve(suggestion);
                            })
                            .fail(function () {
                                resolver.resolve(suggestion);
                            });
                        return resolver;
                    },
                    enrichResponse: function (response, query, fnProcess) {
                        var that = this,
                            suggestions = response.suggestions || [],
                            resolver = $.Deferred();

                        if (suggestions.length) {
                            return resolver.resolve(response);
                        }

                        startRequest.call(that, query)
                            .done(function (resp) {
                                var data = resp.data,
                                    value;
                                data = data && data[0] && data[0][0];
                                if (data) {
                                    delete data.source;
                                    value = that.type.composeValue(data);
                                    if (value) {
                                        $.each(fieldParsers, function (field, parser) {
                                            if (field in data) {
                                                $.extend(data, parser(data[field]));
                                            }
                                        });
                                        response.suggestions = [
                                            {
                                                value: value,
                                                data: data
                                            }
                                        ];
                                        if (fnProcess) {
                                            fnProcess.call(that, response.suggestions);
                                        }
                                    }
                                }
                                resolver.resolve(response);
                            })
                            .fail(function () {
                                resolver.resolve(response);
                            });
                        return resolver;
                    }
                }
            }())
        };

        var methods = {
            selectEnrichService: function () {
                var that = this,
                    type = that.options.type,
                    token = $.trim(that.options.token);

                if (that.options.useDadata && type && types[type] && token) {
                    that.enrichService = enrichServices[types[type].enrichServiceName || 'dadata'];
                } else {
                    that.enrichService = enrichServices['default'];
                }
            }
        };

        Suggestions.dadataConfig = dadataConfig;

        setOptionsHooks.push(methods.selectEnrichService);

    }());