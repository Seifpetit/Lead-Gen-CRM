# backend/routes

Authenticated HTTP endpoints. Thin handlers that call the runner and the data layer.
Every route requires a session unless registered with `config: { public: true }`; read the
user with `currentUser(request)` and pass its `id` to the data layer.
