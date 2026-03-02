declare module 'yaml' {
  const YAML: {
    parse: (input: string) => unknown
  }
  export default YAML
}
