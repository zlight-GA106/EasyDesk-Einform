package com.easysmart.einform.core;

/** A frame must be painted before its dwell timer starts. No network or Android dependency. */
public final class RefreshSequence {
    public enum Frame { PROMPT, BLACK, WHITE, PAGE }
    public interface Scheduler { void after(long millis, Runnable action); }
    public interface Renderer { void show(Frame frame, Runnable painted); }
    public interface Completion { void complete(); }
    private final Scheduler scheduler;
    private final Renderer renderer;
    private final Completion completion;
    private final Frame[] frames;
    private final int dwell;
    private int index = -1;
    private boolean cancelled;
    private boolean painted;

    public RefreshSequence(Scheduler scheduler, Renderer renderer, Completion completion, int dwell, boolean deep, boolean clean) {
        this.scheduler = scheduler; this.renderer = renderer; this.completion = completion;
        this.dwell = Math.max(300, Math.min(3000, dwell));
        frames = !clean ? new Frame[]{Frame.PAGE} : deep
            ? new Frame[]{Frame.PROMPT, Frame.BLACK, Frame.WHITE, Frame.BLACK, Frame.WHITE, Frame.PAGE}
            : new Frame[]{Frame.PROMPT, Frame.BLACK, Frame.WHITE, Frame.PAGE};
    }
    public void start() { if (index == -1 && !cancelled) next(); }
    public void cancel() { cancelled = true; }
    private void next() {
        if (cancelled) return;
        index++; painted = false;
        if (index == frames.length) { completion.complete(); return; }
        final int expected = index;
        renderer.show(frames[index], new Runnable() {
            public void run() {
                if (cancelled || painted || index != expected) return;
                painted = true;
                scheduler.after(dwell, new Runnable() {
                    public void run() { if (!cancelled && index == expected) next(); }
                });
            }
        });
    }
}
