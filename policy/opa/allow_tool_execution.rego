package clearglass.authz

default allow = false

approved_tools := {
  "summarization",
  "reporting",
  "retrieval"
}

allow {
  input.user.role == "engineer"
  approved_tools[input.tool]
}

allow {
  input.user.role == "governor"
}
