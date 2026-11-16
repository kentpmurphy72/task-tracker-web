import { requireChatGPTUser } from "./chatgpt-auth";
import TaskManager from "./task-manager";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <TaskManager userName={user.fullName ?? user.email.split("@")[0]} />;
}
