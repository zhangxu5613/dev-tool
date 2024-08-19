export default class JSONFormat {
    _typeof(object) {
        let tf = typeof object,
            ts = Object.prototype.toString.call(object);
        return null === object ? 'Null' : 'undefined' == tf ? 'Undefined' : 'boolean' == tf ? 'Boolean' : 'number' == tf ? 'Number' : 'string' == tf ? 'String' : '[object Function]' == ts ? 'Function' : '[object Array]' == ts ? 'Array' : '[object Date]' == ts ? 'Date' : 'Object';
    }

    indent_tab(indent_count) {
        return (new Array(indent_count + 1)).join('<span class="json_nbsp">%yxpnbspyxp;%yxpnbspyxp;%yxpnbspyxp;%yxpnbspyxp;</span>');
    }

    _format_null(object) {
        console.log(object)
        return '<span class="json_null" contenteditable="true">null</span>';
    }

    _format_boolean(object) {
        return '<span class="json_boolean" contenteditable="true">' + object + '</span>';
    }

    _format_number(object) {
        return '<span class="json_number" contenteditable="true">' + object + '</span>';
    }

    _format_string(object) {
        // 2023-2-20禁用
        object = object.replace("/\\</g", "%yxplt;");
        object = object.replace("/\\>/g", "%yxpgt;");
        // 2023-2-20禁用
        if (0 <= object.search(/^http/)) {
            object = '<a href="' + object + '" target="_blank" class="json_link">' + object + '</a>'
        }
        return '<span class="json_string" contenteditable="true">"' + object + '"</span>';
    }

    _format_array(object, indent_count) {
        let tmp_array = [];
        for (let i = 0,
            size = object.length; i < size; ++i) {
            tmp_array.push(this.indent_tab(indent_count) + this.format(object[i], indent_count + 1));
        }
        return '<span data-type="array" data-size="' + tmp_array.length + '"><i  style="cursor:pointer;" class="ti ti-square-rounded-minus"></i>[<br/>' + tmp_array.join(',<br/>') + '<br/>' + this.indent_tab(indent_count - 1) + ']</span>';
    }

    _format_object(object, indent_count) {
        let tmp_array = [];
        for (let key in object) {
            let keyRe = key.replace('jsondotcnprefixyxp', '');
            tmp_array.push(this.indent_tab(indent_count) + '<span class="json_key" contenteditable="true">"' + keyRe + '"</span>:<span class="json_nbsp">%yxpnbspyxp;</span>' + this.format(object[key], indent_count + 1));
        }
        return '<span  data-type="object"><i  style="cursor:pointer;" class="ti ti-square-rounded-minus"></i>{<br/>' + tmp_array.join(',<br/>') + '<br/>' + this.indent_tab(indent_count - 1) + '}</span>';
    }

    format(object, indent_count) {
        let html_fragment = '';
        switch (this._typeof(object)) {
            case 'Null': 0
                html_fragment = this._format_null(object);
                break;
            case 'Boolean':
                html_fragment = this._format_boolean(object);
                break;
            case 'Number':
                html_fragment = this._format_number(object);
                break;
            case 'String':
                //replace blank to html blank to display in html.
                object = object.replace(/ /g, "%yxpnbspyxp;");
                html_fragment = this._format_string(object);
                break;
            case 'Array':
                html_fragment = this._format_array(object, indent_count);
                break;
            case 'Object':
                // if (object instanceof BigNumber) {
                //     html_fragment = _format_number(object.toFixed());
                // } else {
                html_fragment = this._format_object(object, indent_count);
                // }
                break;
        }
        return html_fragment;
    }

    loadCssString() {
        let style = document.createElement('style');
        style.type = 'text/css';
        let code = Array.prototype.slice.apply(arguments).join('');
        try {
            style.appendChild(document.createTextNode(code));
        } catch (ex) {
            style.styleSheet.cssText = code;
        }
        document.getElementsByTagName('head')[0].appendChild(style);
    }

    // loadCssString('.json_key{ color: #92278f;font-weight:bold;}', '.json_null{color: #f1592a;font-weight:bold;}', '.json_string{ color: #3ab54a;font-weight:bold;}', '.json_number{ color: #25aae2;font-weight:bold;}', '.json_boolean{ color: #f98280;font-weight:bold;}', '.json_link{ color: #61D2D6;font-weight:bold;}', '.json_nbsp{ letter-spacing: 4px; }', '.json_array_brackets{}');

    constructor(origin_data) {
        // this.data = origin_data ? origin_data :
        //     JSON && JSON.parse ? JSON.parse(origin_data) : eval('(' + origin_data + ')');
        // let stringedJSON = origin_data.replace(/:\s*\"(.*)?\[(.*)?\](.*)?\"\s*(,)?/g, ': "$1jsonbracketsdoctor$2jsonbracketsdoctor$3"$4');
        // 将s”: 78替换成s": jsondotcnprefix78 =======
        let stringedJSON = origin_data.replace(/([^\\]")\s*:\s*([-+Ee0-9.]+)\s*(,)?/g,
            function (match, p1, p2, p3) {
                return ((p1 || '') + ': ' + '"jsondotcnprefix' + (p2 || '') + '"' + (p3 || ''));
            });
        // 将字符串“1，2，3”中的数字添加前缀，以免在下面匹配时被替换
        stringedJSON = stringedJSON.replace(/("\s*)((\\"|[^"])*)\s*(")/g,
            function (match, p1, p2, p3, p4) {
                // console.log(p2)
                let replaceStr = p2.replace(/(,|^)(\s*)(\d+)(\s*)(?=,|$)/g,
                    function (match, p1, p2, p3) {
                        return ((p1 || '') + 'jsondotyxpprefixyxp' + (p2 || '') + (p3 || ''));
                    });
                replaceStr = replaceStr.replace(/(\[)\s*(\d+)/g,
                    function (match, p1, p2) {
                        return ((p1 || '') + 'jsondotyxpprefixyxp' + (p2 || ''));
                    });
                replaceStr = replaceStr.replace(/(\d+)(])/g,
                    function (match, p1, p2) {
                        return ('jsondotyxpprefixyxp' + (p1 || '') + (p2 || ''));
                    });
                return p1 + replaceStr + p4;
            });
        // 将,78,替换成,jsondotcnprefix78,
        stringedJSON = stringedJSON.replace(/(,|^)\s*(\d+)\s*(?=,|$)/g,
            function (match, p1, p2) {
                return (p1 + '"jsondotcnprefix' + (p2 || '') + '"');
            });
        // 将s": [78替换成s" [jsondotcnprefix78
        stringedJSON = stringedJSON.replace(/([^\\]")\s*:\s*(\[)\s*([-+Ee0-9.]+)\s*(,)?\s*(])?/g,
            function (match, p1, p2, p3, p4, p5) {
                return ((p1 || '') + ': ' + (p2 || '') + '"jsondotcnprefix' + (p3 || '') + '"' + (p4 || '') + (p5 || ''));
            });
        // 将,78],"替换成,jsondotcnprefix78],"
        stringedJSON = stringedJSON.replace(/(,)\s*([-+Ee0-9.]+)\s*(])\s*/g,
            function (match, p1, p2, p3) {
                return ((p1 || '') + '"jsondotcnprefix' + (p2 || '') + '"' + (p3 || ''));
            });
        // stringedJSON = stringedJSON.replace(/(\[)\s*([-+Ee0-9.]+)\s*(,)?\s*(\])?/g, '$1"jsondotcnprefix$2"$3$4');
        // stringedJSON = stringedJSON.replace(/(,)\s*([-+Ee0-9.]+)\s*(\])?/g, '$1"jsondotcnprefix$2"$3');
        stringedJSON = stringedJSON.replace(/"([-+Ee0-9.]+)"\s*:\s*/g,
            function (match, p1) {
                return ('"jsondotcnprefixyxp' + (p1 || '') + '": ');
            });
        stringedJSON = stringedJSON.replace(/jsondotyxpprefixyxp/g, '');
        // console.log(stringedJSON)
        try {
            let temp = JSON.parse(stringedJSON, (key, value) => {
                // only changing strings
                if (typeof value !== 'string') return value;
                // only changing number strings
                if (!value.startsWith('jsondotcnprefix')) return value;
                // chop off the prefix
                value = value.slice('jsondotcnprefix'.length);
                // pick your favorite arbitrary-precision library
                return value;
            });
            this.data = temp;
        } catch (e) {
            this.data = JSON.parse(origin_data);
            console.log(e);
        } finally {
            console.log("test");
        }
        //this.data = o;//JSON.parse(origin_data);
    }
    toString() {
        return this.format(this.data, 1)
    }
}