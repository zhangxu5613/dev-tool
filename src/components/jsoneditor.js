export default class JSONFormat {
    indent_tab(indent_count) {
        return (new Array(indent_count + 1)).join('<span>&nbsp;&nbsp;&nbsp;&nbsp;</span>');
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
        // object = object.replace("/\\</g", "%yxplt;");
        // object = object.replace("/\\>/g", "%yxpgt;");
        // 2023-2-20禁用
        if (0 <= object.search('/^http/')) {
            object = '<a href="' + object + '" target="_blank" class="json_link">' + object + '</a>'
        }
        return '<span class="json_string" contenteditable="true">"' + object + '"</span>';
    }

    _format_array(object, indent_count) {
        let tmp_array = [];
        for (let i = 0, size = object.length; i < size; ++i) {
            console.log('array', object[i], typeof (object[i]));
            tmp_array.push(this.indent_tab(indent_count) + this.format(object[i], indent_count + 1));
        }
        return '<span data-type="array" data-size="' + tmp_array.length + '">[' + tmp_array.length + ']<i  style="cursor:pointer;" class="ti ti-square-rounded-minus" ></i>[<br/>' + tmp_array.join(',<br/>') + '<br/>' + this.indent_tab(indent_count - 1) + ']</span>';
    }

    _format_object(object, indent_count) {
        let tmp_array = [];
        for (let key in object) {
            tmp_array.push(this.indent_tab(indent_count) + '<span class="json_key" contenteditable="true">"' + key + '"</span>:<span class="json_nbsp"></span>' + this.format(object[key], indent_count + 1));
        }
        return '<span style="text-align: left;"><i  style="cursor:pointer;" class="ti ti-square-rounded-minus"></i>{<br/>' + tmp_array.join(',<br/>') + '<br/>' + this.indent_tab(indent_count - 1) + '}</span>';
    }

    format(object, indent_count) {
        let html_fragment = '';
        switch (typeof (object)) {
            case 'Null':
                html_fragment = this._format_null(object);
                break;
            case 'boolean':
                html_fragment = this._format_boolean(object);
                break;
            case 'number':
                html_fragment = this._format_number(object);
                break;
            case 'string':
                html_fragment = this._format_string(object);
                break;
            case 'array':
                html_fragment = this._format_array(object, indent_count);
                break;
            case 'object':
                console.log("Array.isArray(object)", Array.isArray(object))
                if (Array.isArray(object)) {
                    html_fragment = this._format_array(object, indent_count);
                } else {
                    html_fragment = this._format_object(object, indent_count);
                }
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

    constructor(origin_data) {
        try {
            let temp = JSON.parse(origin_data);
            this.data = temp;
            console.log(this.data)
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