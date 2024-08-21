<template>
  <div class="json-tree">
    <div v-for="(item, index) in data" :key="`${item.key}-${index}`" class="json-tree-item">
      <p class="json-tree-line">
        {{ item.key }}
        <span v-if="item.type === 'object'">
          <span v-text="': \{'"></span>
        </span>
        <span v-else-if="item.type === 'array'">
          <span v-text="': \['"></span>
        </span>
        <span v-else>
          <span v-pre>:</span>
          <span style="margin-left: 15px;">
            {{ item.type === 'string' ? `"${item.value}"` : `${item.value}` }}
          </span>
          <span v-if="index < data.length - 1">,</span>
        </span>
        <el-tooltip class="item" effect="dark" :content="item.path" placement="top-start">
          <span class="path-btn" @click="getPath(item.path)">path</span>
        </el-tooltip>
      </p>
      <div v-if="item.leaf" class="children-tree">
        <json-tree :data="item.children"></json-tree>
      </div>
      <span v-if="item.type === 'object'">
        <span v-text="'\}'"></span>
        <span v-if="index < data.length - 1">,</span>
      </span>
      <span v-else-if="item.type === 'array'">
        <span v-text="'\]'"></span>
        <span v-if="index < data.length - 1">,</span>
      </span>
    </div>
  </div>
</template>

<script>
import bus from '@/utils/bus'
export default {
  name: 'jsonTree',
  props: {
    data: Array
  },
  data() {
    return {

    };
  },

  mounted() {

  },

  methods: {
    getPath(path) {
      bus.$emit('handlePath', path)
    }
  },
};
</script>

<style lang="scss" scoped>
.json-tree {
  .json-tree-item {
    margin: 20px 0px;

    .json-tree-line {
      .path-btn {
        background: #37f;
        color: #fff;
        padding: 2px 6px;
        font-size: 12px;
        cursor: pointer;
        border-radius: 3px;
        margin-left: 20px;
      }
    }

    .children-tree {
      margin-left: 20px;
    }
  }
}
</style>