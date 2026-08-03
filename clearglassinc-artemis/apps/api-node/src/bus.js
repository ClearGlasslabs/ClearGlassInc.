// Event metadata only is logged. Configure a durable bus producer in production.
export async function publish(topic, message) {
  const safeMetadata = { id: message?.id ?? message?.event?.id ?? message?.action_id, type: message?.event?.type, decision: message?.decision };
  console.log(JSON.stringify({ event: "bus.publish", topic, metadata: safeMetadata }));
}
