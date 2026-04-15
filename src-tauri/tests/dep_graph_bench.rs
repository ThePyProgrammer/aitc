//! D-24 benchmark: 10k-file repo dep-graph build target <2s.
//!
//! Run with:
//!   cargo test --test dep_graph_bench -- --ignored bench_dep_graph_10k --nocapture
//!
//! Marked `#[ignore]` so it doesn't run under the default test pipeline — it
//! writes 10k files to a tempdir (roughly 2-4 MiB of synthetic source) and
//! takes 10-30 seconds to set up even though the parse itself is the
//! benchmarked section.

use aitc_lib::pipeline::deps::build_dependency_graph;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use tempfile::TempDir;

#[test]
#[ignore]
fn bench_dep_graph_10k() {
    let dir = TempDir::new().unwrap();
    let root = dir.path();
    let n: usize = 10_000;
    println!("Generating {n} synthetic .ts files...");
    let gen_start = Instant::now();
    for i in 0..n {
        // Each file imports 5 nearest-forward neighbours — gives ~5 edges/file
        // and ensures realistic lookup cost in the resolver.
        let mut content = String::with_capacity(2048);
        for j in 1..=5 {
            let target = (i + j) % n;
            content.push_str(&format!("import x{j} from './f{target}';\n"));
        }
        // Pad to ~200 LOC so tree-sitter sees non-trivial input.
        for _ in 0..195 {
            content.push_str("// padding line\n");
        }
        fs::write(root.join(format!("f{i}.ts")), content).unwrap();
    }
    println!("Generated in {:?}", gen_start.elapsed());
    let files: Vec<PathBuf> = (0..n).map(|i| root.join(format!("f{i}.ts"))).collect();

    let start = Instant::now();
    let result = build_dependency_graph(root, &files);
    let elapsed = start.elapsed();
    println!(
        "build_dependency_graph: {:?} for {} files, {} edges, degraded={}, unresolved={}",
        elapsed,
        files.len(),
        result.edges.len(),
        result.degraded,
        result.unresolved_count
    );
    assert!(
        elapsed.as_millis() < 2000,
        "D-24 violated: {} ms > 2000 ms target",
        elapsed.as_millis()
    );
    assert!(
        result.edges.len() > 40_000,
        "expected ~50k edges (5 per file × 10k), got {}",
        result.edges.len()
    );
}
