<template>
  <div id="app">
    <JsonPretty msg="Welcome to Your Vue.js App" />
  </div>
</template>

<script>
import JsonPretty from './components/JsonPretty.vue'

export default {
  name: 'App',
  components: {
    JsonPretty
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
