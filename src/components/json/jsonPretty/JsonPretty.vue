<template>
    <div style="text-align: left; display: grid;  grid-template-columns: 1fr 1fr;">
        <div class="half">
            <div style="margin: 10px;">
                <el-checkbox v-model="excludeSpecial" @change="freshJson">去除转义</el-checkbox>
            </div>
            <el-input type="textarea" id="json-src" :rows="textareaRows" placeholder="请输入内容" v-model="json_in"
                @input="jsonKeyUp">
            </el-input>
        </div>
        <div class="half">
            <div style="margin: 10px;">
                <el-button type="primary" icon="el-icon-document-copy" circle style="margin-right: 15px;" size="mini"
                    @click="copyToClipboard"></el-button>
                <el-checkbox v-model="showLineNumberOption">显示行号</el-checkbox>
                <el-checkbox v-model="showLineOption">显示对齐线</el-checkbox>
            </div>
            <div class="divider"></div>
            <div style="border:  2px;"> </div>
            <div style="height: 1075px; overflow: auto; border: 1px solid red; resize: none">
                <vue-json-pretty v-if='json_out != ""' :data="json_out" showLength :showLine="showLineOption"
                    :showLineNumber="showLineNumberOption" />
            </div>
        </div>
    </div>
</template>

<script>
import VueJsonPretty from 'vue-json-pretty';

import 'vue-json-pretty/lib/styles.css';
export default {
    name: 'JsonPretty',
    props: {
        msg: String
    },
    components: {
        VueJsonPretty
    },
    data() {
        return {
            json_in: "",
            textareaRows: 20,
            json_out: "",
            showLineOption: true,
            showLineNumberOption: false,
            excludeSpecial: true,
            showItem: true
        };
    },
    methods: {
        handleSelect(key, keyPath) {
            console.log(key, keyPath);
            this.showContent = key;
        },
        jsonKeyUp(data) {
            try {
                this.json_out = JSON.parse(data);
            } catch (error) {
                console.log(data)
                if (this.excludeSpecial) {
                    try {
                        console.log(data.replace(/[\r\t\\]/g, ''))
                        this.json_out = JSON.parse(data.replace(/[\r\t\\]/g, ''));
                    } catch (error) {
                        this.json_out = error.toString()
                    }
                } else {
                    this.json_out = error.toString()
                }
            }
        },
        copyToClipboard() {
            console.log("copyToClipboard")
            navigator.clipboard.writeText(JSON.stringify(this.json_out, null, 4))
                .then(() => {
                    console.log('已复制到剪贴板');
                })
                .catch((error) => {
                    console.error('复制失败:', error);
                });
        },
        freshJson() {
            console.log(this.json_in)
            this.jsonKeyUp(this.json_in)
        },
        calculateTextareaRows() {
            const windowHeight = window.innerHeight;
            const textareaElement = this.$el.querySelector('textarea');
            const lineHeight = parseInt(getComputedStyle(textareaElement).lineHeight);
            const padding = parseInt(getComputedStyle(textareaElement).paddingTop) + parseInt(getComputedStyle(textareaElement).paddingBottom);
            const newRows = Math.floor((windowHeight - padding) * 85 / 100 / lineHeight);
            this.textareaRows = newRows;
        }
    },
    mounted() {
        this.calculateTextareaRows();
    }

}
</script>

<!-- Add "scoped" attribute to limit CSS to this component only -->
<style scoped>
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

.divider {
    width: 100%;
    height: 1px;
    background-color: #000;
    margin: 0px;
}
</style>
