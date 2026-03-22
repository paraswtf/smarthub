module.exports = {
	apps: [
		{
			name: "esp-hub-frontend",
			script: "npm",
			args: "run start",
			cwd: __dirname,
			env: {
				NODE_ENV: "production",
				PORT: 80
			}
		},
		{
			name: "esp-hub-ws",
			script: "npm",
			args: "run ws",
			cwd: __dirname,
			env: {
				NODE_ENV: "production",
				PORT: 4001
			}
		}
	]
};
