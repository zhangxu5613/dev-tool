<template>
  <div class="json-path">
    <el-row :gutter="20">
      <el-col :span="12">
        <editor ref="aceEditor" v-model="content" width="100%" height="640" lang="json" :theme="theme" :options="{
          enableBasicAutocompletion: true, //启用基本自动完成
          enableSnippets: true, // 启用代码段
          enableLiveAutocompletion: true, //启用实时自动完成
          tabSize: 2, //制表符大小
          fontSize: 14, //设置字号
          showPrintMargin: false  //去除编辑器里的竖线
        }" @init="editorInit" @input="editorInput"></editor>
      </el-col>
      <el-col :span="12">
        <div style="width: 100%;">
          <el-input placeholder="自动生成JSONPath" v-model="pathText" style="font-size: 16px;">
            <template slot="prepend">JSONPath</template>
            <template slot="append">
              <!-- <el-button 
                v-clipboard:copy="pathText"
                v-clipboard:success="firstCopySuccess"
                v-clipboard:error="firstCopyError"
              >复制</el-button> -->
              <el-button @click="onCopy">复制</el-button>
            </template>
          </el-input>
        </div>
        <div class="json-path-parser">
          <div class="error-message" v-if="error">{{ errorMessage }}</div>
          <template v-else>
            <json-tree :data="parserArray"></json-tree>
          </template>
        </div>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import jsonTree from './jsonTree.vue'
import bus from '@/utils/bus'
export default {
  name: 'JsonXmlPathIndex',
  components: {
    editor: require('vue2-ace-editor'),
    jsonTree
  },
  data() {
    return {
      content: '',
      theme: 'tomorrow_night',
      error: false,
      errorMessage: '',
      json: {},
      parserArray: [],
      pathText: ''
    };
  },
  watch: {
    json: {
      deep: true,
      immediate: true,
      handler(val) {
        this.parserArray = []
        this.jsonPath(this.parserArray, val, '$')
      }
    }
  },
  created() {
    bus.$on('handlePath', this.handlePath)
  },
  mounted() {
    this.editorInit()
    this.parserJson(this.content)
  },

  methods: {
    firstCopySuccess(e) {
      console.log('复制成功：', e);
      this.$message.success('复制成功')
    },
    firstCopyError(e) {
      console.log('复制失败：', e);
      this.$message.error('复制失败')
    },
    onCopy() {
      this.$copyText(this.pathText).then(e => {
        console.log('复制成功：', e);
        this.$message.success('复制成功')
      }, e => {
        console.log('复制失败：', e);
        this.$message.error('复制失败')
      })
    },
    handlePath(path) {
      this.pathText = path
    },
    editorInit() {
      require("brace/ext/language_tools")
      require("brace/mode/json")
      require("brace/theme/tomorrow_night")
      require("brace/snippets/json")
    },
    editorInput(val) {
      this.parserJson(val)
    },
    parserJson(val) {
      try {
        this.json = JSON.parse(val)
        this.error = false
        this.errorMessage = ''
      } catch (e) {
        this.error = true
        this.errorMessage = e.message
      }
    },
    jsonPath(arr, json, basePath) {
      // 生成jsonpath
      const type = this.validateType(json)
      if (type === 'object') {
        for (let key in json) {
          const item = {
            key,
            path: `${basePath}.${key}`
          }
          const childType = this.validateType(json[key])
          item.type = childType
          if (childType === 'object' || childType === 'array') {
            item.leaf = true
            item.children = []
            this.jsonPath(item.children, json[key], item.path)
          } else {
            item.leaf = false
            item.value = json[key]
          }
          arr.push(item)
        }
      } else if (type === 'array') {
        json.forEach((item, index) => {
          const childType = this.validateType(item)
          const obj = {
            key: index
          }
          obj.type = childType
          obj.path = `${basePath}[${index}]`
          if (childType === 'object' || childType === 'array') {
            obj.leaf = true,
              obj.children = []
            this.jsonPath(obj.children, item, obj.path)
          } else {
            obj.value = item
            obj.leaf = false
          }
          arr.push(obj)
        })
      }
    },
    validateType(val) {
      // 校验JSON数据类型
      const type = typeof val
      if (type === 'object') {
        if (Array.isArray(val)) {
          return 'array'
        } else if (val === null) {
          return 'null'
        } else {
          return 'object'
        }
      } else {
        switch (type) {
          case 'boolean':
            return 'boolean';
          case 'string':
            return 'string';
          case 'number':
            return 'number';
          default:
            return 'error'
        }
      }
    }
  },
};
</script>

<style lang="scss" scoped>
.json-path {
  box-sizing: border-box;
  padding: 10px 20px;

  .el-row {
    height: 600px;

    .el-col {
      text-align: left;
      height: 100%;

      .json-path-parser {
        border: 1px solid #cacaca;
        box-shadow: 3px 3px 4px rgba($color: #000000, $alpha: 0.1);
        border-radius: 3px;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        padding: 10px 20px;
        overflow-y: scroll;

        .error-message {
          font-size: 16px;
          color: red;
        }
      }
    }
  }
}
</style>