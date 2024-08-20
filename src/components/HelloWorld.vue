<template>
    <div>
        <div class="line"></div>
        <el-menu :default-active="activeIndex2" class="el-menu-demo" mode="horizontal" @select="handleSelect"
            background-color="#545c64" text-color="#fff" active-text-color="#ffd04b">
            <el-menu-item index="1">处理中心</el-menu-item>
            <el-submenu index="2">
                <template slot="title">我的工作台</template>
                <el-menu-item index="2-1" font="Warning">选项1</el-menu-item>
                <el-menu-item index="2-2">选项2</el-menu-item>
                <el-menu-item index="2-3">选项3</el-menu-item>
                <el-submenu index="2-4">
                    <template slot="title">选项4</template>
                    <el-menu-item index="2-4-1">选项1</el-menu-item>
                    <el-menu-item index="2-4-2">选项2</el-menu-item>
                    <el-menu-item index="2-4-3">选项3</el-menu-item>
                </el-submenu>
            </el-submenu>
            <el-menu-item index="3" disabled>消息中心</el-menu-item>
        </el-menu>
        <div class="container" style="text-align: left;">
            <div class="half">
                <el-input type="textarea" id="json-src" :rows="textareaRows" placeholder="请输入内容" v-model="json_in"
                    @input="jsonKeyUp">
                </el-input>
            </div>
            <div class="half">
                <div style="margin: 10px;">
                    <el-checkbox v-model="showLineNumberOption">显示行号</el-checkbox>
                    <el-checkbox v-model="showLineOption">显示对齐线</el-checkbox>
                </div>
                <div class="divider"></div>
                <div style="border:  2px;"> </div>
                <vue-json-pretty v-if='json_out != ""' :data="json_out" showLength :showLine="showLineOption"
                    :showLineNumber="showLineNumberOption" />
            </div>
        </div>
    </div>
</template>

<script>
import JSONFormat from './jsoneditor';
import VueJsonPretty from 'vue-json-pretty';
import 'vue-json-pretty/lib/styles.css';
export default {
    name: 'HelloWorld',
    props: {
        msg: String
    },
    components: {
        VueJsonPretty
    },
    data() {
        return {
            activeIndex: '1',
            activeIndex2: '1',
            json_in: "",
            json_out_html: '',
            textareaRows: 20,
            json_out: "",
            showLineOption: false,
            showLineNumberOption: false,
            showItem: true
        };
    },
    methods: {
        handleSelect(key, keyPath) {
            console.log(key, keyPath);
        },
        loadExternalCSS() {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '//static.json.cn/r/css/global.css';
            document.head.appendChild(link);

            const link2 = document.createElement('link');
            link2.rel = 'stylesheet';
            link2.href = '//static.json.cn/r/vendor/css/rtl/core.css';
            document.head.appendChild(link2);

            const link3 = document.createElement('link');
            link3.rel = 'stylesheet';
            link3.href = '//static.json.cn/r/vendor/css/rtl/theme-default.css';
            document.head.appendChild(link3);

            const link4 = document.createElement('link');
            link4.rel = 'stylesheet';
            link4.href = '//static.json.cn/r/css/demo.css';
            document.head.appendChild(link4);

            const link5 = document.createElement('link');
            link5.rel = 'stylesheet';
            link5.href = '//static.json.cn/r/css/index.css?202408131954';
            document.head.appendChild(link5);
        },
        jsonKeyUp(data) {
            try {
                this.json_out = JSON.parse(data);
                let json_fomat = new JSONFormat(data);
                this.json_out_html = json_fomat.toString();
            } catch (error) {
                console.log(error)
                this.json_out = error
            }
        },
        calculateTextareaRows() {
            const windowHeight = window.innerHeight;
            const textareaElement = this.$el.querySelector('textarea');
            const lineHeight = parseInt(getComputedStyle(textareaElement).lineHeight);
            const padding = parseInt(getComputedStyle(textareaElement).paddingTop) + parseInt(getComputedStyle(textareaElement).paddingBottom);
            const newRows = Math.floor((windowHeight - padding) * 85 / 100 / lineHeight);
            this.textareaRows = newRows;
        },
        changeItemShow() {
            console.log("click")
            this.showItem = !this.showItem
        }
    },
    mounted() {
        this.loadExternalCSS();
        this.calculateTextareaRows();
    }

}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
h3 {
    margin: 40px 0 0;
}

ul {
    list-style-type: none;
    padding: 0;
}

li {
    display: inline-block;
    margin: 0 10px;
}

a {
    color: #42b983;
}

.half {
    border: 1px solid black;
    margin: 5px;
    /* 为了可视化效果，添加边框样式 */
}

.half textarea {
    width: 100%;
    /* 设置 textarea 宽度为容器宽度的 100% */
    height: 100%;
    /* 设置 textarea 高度为容器高度的 100% */
    box-sizing: border-box;
    /* 让 textarea 的尺寸包括边框和内边距 */
    resize: none;
    /* 禁止 textarea 的大小调整 */
}

.indent {
    margin-left: 500px;
}

.container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    /* 将容器分为两列，每列宽度相等 */
    width: 98%;
    /* 设置容器宽度为网页宽度的 80% */
    margin: 0 auto;
    /* 居中容器 */
    height: auto;
    /* 设置容器高度为视口高度 */
    border: 1px solid black;
    /* 为了可视化效果，添加边框样式 */
}

.divider {
    width: 100%;
    height: 1px;
    background-color: #000;
    margin: 0px;
}
</style>
