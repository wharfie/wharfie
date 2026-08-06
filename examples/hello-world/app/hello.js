export function hello(name = 'world') {
  return `Hello, ${name}!`;
}

export function main(argv = process.argv) {
  process.stdout.write(`${hello(argv[2])}\n`);
}
