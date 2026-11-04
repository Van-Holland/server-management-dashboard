// Makes the three login values for the server's .env. Run on the Mac:
//   node scripts/hash-password.mjs
// It asks for the password (nothing is shown while you type) and prints three lines to paste into .env.
// The password itself is never printed or stored; only a one-way scramble of it.
import { randomBytes, scryptSync } from "node:crypto"
import readline from "node:readline"

function ask(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      let data = ""
      process.stdin.on("data", (c) => (data += c))
      process.stdin.on("end", () => resolve(data.replace(/\r?\n$/, "")))
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true })
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stderr.write(s) }
    rl.question(question, (answer) => { rl.close(); process.stderr.write("\n"); resolve(answer) })
  })
}

const password = await ask("New dashboard password: ")
if (password.length < 12) {
  console.error("Use at least 12 characters (a few random words is fine).")
  process.exit(1)
}
if (process.stdin.isTTY && (await ask("Again: ")) !== password) {
  console.error("They do not match.")
  process.exit(1)
}
const salt = randomBytes(16)
console.log(`AUTH_PASSWORD_HASH=scrypt:${salt.toString("hex")}:${scryptSync(password, salt, 64).toString("hex")}`)
console.log(`AUTH_SECRET=${randomBytes(32).toString("hex")}`)
console.log(`CRON_TOKEN=${randomBytes(24).toString("hex")}`)
