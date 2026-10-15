package com.cgscenestudio.player;

import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

/** Standalone JDK storage check. All fixtures remain under the supplied project tmp directory. */
public final class ManagedPackageFilesCheck {
    private static int checks;
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
        checks++;
    }
    public static void main(String[] args) throws Exception {
        Path fixture = Paths.get(args[0]).resolve("package-storage-" + UUID.randomUUID());
        ManagedPackageFiles files = new ManagedPackageFiles(fixture.resolve("packages"));
        String id = UUID.randomUUID().toString();
        Path active = files.path(id, false);
        Files.createDirectories(active.resolve("media"));
        Files.write(active.resolve("package.json"), new byte[]{1, 2, 3});
        Files.write(active.resolve("media/fixture.bin"), new byte[]{4, 5});
        Path external = fixture.resolve("outside.txt");
        Files.write(external, new byte[]{7, 8, 9});
        check(files.size(id, false) == 5, "Sizes must count files, not directory entries");
        files.purge(id);
        check(Files.exists(active.resolve("package.json")), "Purge must not delete active copies");
        files.move(id, true);
        check(!Files.exists(active) && files.size(id, true) == 5, "Move to trash must preserve bytes");
        files.move(id, false);
        check(Files.readAllBytes(active.resolve("media/fixture.bin"))[0] == 4, "Restore must preserve data");
        for (String bad : new String[]{"..", "../outside.txt", "", "example", id + "/.."}) {
            try { files.path(bad, false); throw new AssertionError("Unsafe ID accepted: " + bad); }
            catch (IOException expected) { checks++; }
        }
        Path trash = files.path(id, true);
        Files.createDirectories(trash);
        Files.write(trash.resolve("keep.txt"), new byte[]{6});
        try { files.move(id, true); throw new AssertionError("Move overwrote an existing copy"); }
        catch (IOException expected) { checks++; }
        check(Files.exists(active.resolve("package.json")) && Files.exists(trash.resolve("keep.txt")), "Collision must preserve both copies");
        files.purge(id);
        files.move(id, true);
        try {
            Files.createSymbolicLink(trash.resolve("external-link"), external.toAbsolutePath());
            check(files.size(id, true) == 5, "Size must not follow symbolic links");
        } catch (FileSystemException | UnsupportedOperationException unsupported) {
            System.out.println("Symlink fixture unavailable on this host; file traversal still uses NOFOLLOW behavior.");
        }
        files.purge(id);
        check(!Files.exists(trash), "Purge must release the trashed directory");
        check(Files.readAllBytes(external)[0] == 7, "Outside files must survive purge");
        files.purge(id);
        check(files.size(id, true) == 0, "Missing trash is safe to retry");
        System.out.println("PASS: " + checks + " storage checks; fixtures: " + fixture);
    }
}
