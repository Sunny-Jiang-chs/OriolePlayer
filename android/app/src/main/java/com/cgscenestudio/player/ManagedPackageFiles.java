package com.cgscenestudio.player;

import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;

/** Only application-owned UUID directories can be moved or purged. Never follows links. */
final class ManagedPackageFiles {
    private final Path root;

    ManagedPackageFiles(Path directory) throws IOException {
        Files.createDirectories(directory);
        root = directory.toRealPath();
    }

    Path path(String id, boolean trashed) throws IOException {
        if (id == null || !id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
            throw new IOException("无效的导入作品 ID");
        Path base = trashed ? root.resolve(".trash") : root;
        if (Files.isSymbolicLink(base)) throw new IOException("作品目录不能是符号链接");
        Path result = base.resolve(id).normalize();
        if (!result.getParent().equals(base) || Files.isSymbolicLink(result))
            throw new IOException("作品目录超出应用管理范围");
        return result;
    }

    long size(String id, boolean trashed) throws IOException {
        Path directory = path(id, trashed);
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return 0;
        final long[] bytes = {0};
        Files.walkFileTree(directory, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                if (attrs.isRegularFile()) bytes[0] += attrs.size();
                return FileVisitResult.CONTINUE;
            }
        });
        return bytes[0];
    }

    void move(String id, boolean toTrash) throws IOException {
        Path source = path(id, !toTrash), destination = path(id, toTrash);
        Files.createDirectories(destination.getParent());
        // No REPLACE_EXISTING: a collision must never overwrite another copy.
        Files.move(source, destination);
    }

    void purge(String id) throws IOException {
        Path directory = path(id, true);
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return;
        Files.walkFileTree(directory, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                Files.delete(file);
                return FileVisitResult.CONTINUE;
            }
            @Override public FileVisitResult postVisitDirectory(Path folder, IOException error) throws IOException {
                if (error != null) throw error;
                Files.delete(folder);
                return FileVisitResult.CONTINUE;
            }
        });
    }
}
