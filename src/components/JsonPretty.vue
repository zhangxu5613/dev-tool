<template>
    <div>
        <div class="line"></div>
        <el-tabs type="border-card" style="margin: 0 200px;">
            <el-tab-pane>
                <span slot="label"><i class="el-icon-date"></i> Json处理</span>
                <el-menu :default-active="activeIndex" class="el-menu-demo" mode="horizontal" @select="handleSelect">
                    <el-menu-item index="json-pretty">格式化</el-menu-item>
                    <el-menu-item index="json-path">jsonpath</el-menu-item>
                    <el-menu-item index="json-diff">json-diff</el-menu-item>
                </el-menu>
            </el-tab-pane>
            <el-tab-pane label="消息中心"><span slot="label"><i class="el-icon-date"></i>编解码</span>
                <el-menu :default-active="activeIndex" class="el-menu-demo" mode="horizontal" @select="handleSelect">
                    <el-menu-item index="decode-md5">Md5</el-menu-item>
                    <el-menu-item index="decode-base64">base64</el-menu-item>
                    <el-menu-item index="decode-url">url</el-menu-item>
                </el-menu>
            </el-tab-pane>
            <el-tab-pane label="角色管理">角色管理</el-tab-pane>
            <el-tab-pane label="定时任务补偿">定时任务补偿</el-tab-pane>
        </el-tabs>

        <div v-if='showContent == "json-pretty"' style="text-align: left; width: auto; margin: 0 200px; display: grid;
    grid-template-columns: 1fr 1fr;">
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
        <div id="app" v-if='showContent == "json-diff"' style="width: auto; margin: 0 200px;">
            <div style="display: grid;    grid-template-columns: 10fr 1fr 10fr;">
                <div class=" half">
                    <el-input type="textarea" :rows="10" placeholder="请输入内容" v-model="json_src">
                    </el-input>
                </div>
                <div style="margin-top: auto; margin-bottom: auto ;">
                    <!-- <el-button type="primary" round @click="doCompare">比较</el-button> -->
                </div>
                <div class="half">
                    <el-input type="textarea" :rows="10" placeholder="请输入内容" v-model="json_dst">
                    </el-input>
                </div>
            </div>
            <div class="compare">
                <CodeDiff class="center" :old-string="json_src" :new-string="json_dst" :drawFileList="true"
                    :context="1000" outputFormat="side-by-side" />

            </div>
        </div>
    </div>
</template>

<script>
import VueJsonPretty from 'vue-json-pretty';
import CodeDiff from 'vue-code-diff'

import 'vue-json-pretty/lib/styles.css';
export default {
    name: 'JsonPretty',
    props: {
        msg: String
    },
    components: {
        VueJsonPretty,
        CodeDiff
    },
    data() {
        return {
            json_src: "",
            json_dst: "",
            activeIndex: '1',
            activeIndex2: '1',
            showContent: "json-pretty",
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
            this.showContent = key;
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
        for (let one in this.title) {
            console.log(one.name)
            if (one.name == this.showingMenu) {
                this.subTitle = one.subTitle;
            }
        }
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
    margin: 3px;
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

.ten-one-ten {
    display: grid;
    grid-template-columns: 10fr 1fr 10fr;
    /* 将容器分为两列，每列宽度相等 */
    width: 100%;
    /* 设置容器宽度为网页宽度的 80% */
    margin: 0 auto;
    /* 居中容器 */
    height: auto;
    /* 设置容器高度为视口高度 */
    border: 1px solid rgb(31, 204, 5);
    /* 为了可视化效果，添加边框样式 */
}

.divider {
    width: 100%;
    height: 1px;
    background-color: #000;
    margin: 0px;
}
</style>
