<template>
  <div id="app">
    <JsonOperation msg="Welcome to Your Vue.js App" />
  </div>
</template>

<script>
import JsonOperation from './components/json/index.vue'

export default {
  name: 'App',
  components: {
    JsonOperation
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  margin-top: 10px;
}
</style>
