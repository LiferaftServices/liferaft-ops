import { signOut } from "./actions";
import { LoginForm } from "./login-form";

// Rendered fresh for each request: the page depends on who is asking.
export const instant = false;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { reason } = await searchParams;
  const notStaff = reason === "not-staff";
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-[#FF5200]">
          Liferaft Services
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Operations sign-in</h1>
      </header>
      {notStaff ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-red-700">
            This account is signed in but has not been added as staff. Ask an administrator to add
            you, then sign in again.
          </p>
          <form action={signOut}>
            <button type="submit" className="text-sm font-semibold underline">
              Sign out
            </button>
          </form>
        </div>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
