export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-900 px-6 text-center">
      <div className="mb-4 text-6xl">📡</div>
      <h1 className="mb-2 text-2xl font-bold text-white">You are offline</h1>
      <p className="text-zinc-400">
        Please check your internet connection and try again.
      </p>
    </div>
  );
}
