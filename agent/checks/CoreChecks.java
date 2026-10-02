import com.easysmart.einform.core.RefreshSequence;
import com.easysmart.einform.core.PngGuard;
import com.easysmart.einform.core.HttpTransport;
import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;

public final class CoreChecks {
    static void expect(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static void sequence(boolean deep, boolean clean) {
        final ArrayList<String> seen = new ArrayList<String>();
        final ArrayList<Runnable> timers = new ArrayList<Runnable>();
        final ArrayList<Runnable> painted = new ArrayList<Runnable>();
        final ArrayList<Long> delays = new ArrayList<Long>();
        RefreshSequence sequence = new RefreshSequence(new RefreshSequence.Scheduler() {
            public void after(long millis, Runnable callback) { delays.add(millis); timers.add(callback); }
        }, new RefreshSequence.Renderer() {
            public void show(RefreshSequence.Frame frame, Runnable callback) { seen.add(frame.name()); painted.add(callback); }
        }, new RefreshSequence.Completion() { public void complete() { seen.add("BEEP"); } }, 700, deep, clean);
        sequence.start(); sequence.start();
        expect(timers.isEmpty(), "Must wait for actual draw before delay");
        while (!painted.isEmpty()) {
            Runnable callback = painted.remove(0); callback.run(); callback.run();
            expect(timers.size() == 1, "Duplicate draw must not double advance");
            Runnable advance = timers.remove(0); advance.run(); advance.run();
        }
        String expected = !clean ? "[PAGE, BEEP]" : deep ? "[PROMPT, BLACK, WHITE, BLACK, WHITE, PAGE, BEEP]" : "[PROMPT, BLACK, WHITE, PAGE, BEEP]";
        expect(seen.toString().equals(expected), "Incorrect clean order: " + seen);
        expect(delays.get(delays.size()-1) == 700L, "Beep must wait for final frame to settle");
    }
    static void rejects(byte[] bytes, File file) throws Exception {
        Files.write(file.toPath(), bytes);
        boolean rejected = false;
        try { PngGuard.validate(file); } catch (java.io.IOException expected) { rejected = true; }
        expect(rejected, "Bad PNG accepted");
    }
    public static void main(String[] args) throws Exception {
        sequence(false, true); sequence(true, true); sequence(false, false);
        final ArrayList<Runnable> callbacks = new ArrayList<Runnable>();
        final int[] completed = {0};
        RefreshSequence cancelled = new RefreshSequence(new RefreshSequence.Scheduler() { public void after(long delay, Runnable action) { callbacks.add(action); } },
            new RefreshSequence.Renderer() { public void show(RefreshSequence.Frame frame, Runnable action) { callbacks.add(action); } },
            new RefreshSequence.Completion() { public void complete() { completed[0]++; } },700,false,true);
        cancelled.start(); cancelled.cancel(); callbacks.get(0).run(); expect(completed[0] == 0 && callbacks.size() == 1, "Cancelled cycle advanced");
        File valid = new File(args[0]); PngGuard.validate(valid);
        File bad = File.createTempFile("einform-check-", ".png");
        try {
            byte[] original = Files.readAllBytes(valid.toPath());
            rejects(Arrays.copyOf(original, original.length - 5), bad);
            byte[] corrupt = original.clone(); corrupt[40] ^= 1; rejects(corrupt, bad);
            rejects("<html>not png</html>".getBytes("UTF-8"), bad);
            rejects(Arrays.copyOf(original, original.length+1), bad);
            if (args.length > 1) {
                HttpTransport transport = new HttpTransport(args[1]);
                HttpTransport.ImageResponse response = transport.image("/api/display/Z9-QA.png", "", bad);
                expect(!response.unchanged && response.etag.length()>0, "PNG missing ETag");
                expect(transport.image("/api/display/Z9-QA.png", response.etag, bad).unchanged, "ETag should return 304");
            }
        } finally { bad.delete(); }
        System.out.println("PASS: clean sequence, paint gate, duplicate callbacks, cancellation, PNG CRC/truncation/HTML/trailing data, HTTP ETag");
    }
}
