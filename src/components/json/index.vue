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

        <div class="main_container" v-if='showContent == "json-pretty"'>
            <JsonPretty />
        </div>
        <div class="main_container" v-if='showContent == "json-diff"'>
            <JsonDiff />
        </div>
        <div class="main_container" v-if='showContent == "json-path"'>
            <JsonXmlPathIndex />
        </div>
    </div>
</template>

<script>
import JsonPretty from './jsonPretty/JsonPretty.vue'
import JsonDiff from './jsondiff/JsonDiff.vue'
import JsonXmlPathIndex from './jsonpath/index.vue'

export default {
    name: 'JsonOperation',
    props: {
        msg: String
    },
    components: {
        JsonPretty,
        JsonDiff,
        JsonXmlPathIndex
    },
    data() {
        return {
            activeIndex: '1',
            activeIndex2: '1',
            showContent: "json-pretty"
        };
    },
    methods: {
        handleSelect(key, keyPath) {
            console.log(key, keyPath);
            this.showContent = key;
        }
    },
    mounted() {
        // this.calculateTextareaRows();
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

.main_container {
    border: 2px solid blue;
    width: auto;
    margin: 0 200px;
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
