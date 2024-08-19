<template>
    <div>
        <div class="line"></div>
        <el-menu :default-active="activeIndex2" class="el-menu-demo" mode="horizontal" @select="handleSelect"
            background-color="#545c64" text-color="#fff" active-text-color="#ffd04b">
            <el-menu-item index="1">处理中心</el-menu-item>
            <el-submenu index="2">
                <template slot="title">我的工作台</template>
                <el-menu-item index="2-1">选项1</el-menu-item>
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
        <div class="container">
            <div class="half">
                <el-input type="textarea" id="json-src" :rows="2" placeholder="请输入内容" v-model="textarea">
                </el-input>
            </div>
            <div class="half">
                <div id='json-target'></div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'HelloWorld',
    props: {
        msg: String
    },
    data() {
        return {
            activeIndex: '1',
            activeIndex2: '1'
        };
    },
    methods: {
        handleSelect(key, keyPath) {
            console.log(key, keyPath);
        }
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
}

.container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    /* 将容器分为两列，每列宽度相等 */
    width: 98%;
    /* 设置容器宽度为网页宽度的 80% */
    margin: 0 auto;
    /* 居中容器 */
    height: 90vh;
    /* 设置容器高度为视口高度 */
    border: 1px solid black;
    /* 为了可视化效果，添加边框样式 */
}
</style>
