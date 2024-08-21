<template>
    <div>
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
            <CodeDiff class="center" :old-string="json_src" :new-string="json_dst" :drawFileList="true" :context="1000"
                outputFormat="side-by-side" />

        </div>
    </div>
</template>

<script>

import CodeDiff from 'vue-code-diff'

export default {
    name: 'JsonDiff',
    props: {
    },
    components: {
        CodeDiff
    },
    data() {
        return {
            json_dst: "",
            json_src: ""
        };
    },
    methods: {
        handleSelect(key, keyPath) {
            console.log(key, keyPath);
            this.showContent = key;
        }
    },
    mounted() {
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
