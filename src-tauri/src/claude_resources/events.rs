//! Phase 9: ARSENAL event/resource type contract.
//!
//! Stub placeholder created in Plan 09-01 Task 1 so the module compiles
//! while the full type surface (ResourceEvent, Resource, Category, Scope,
//! ResourceMetadata, ResourceEventBatch, ResourceId) is filled in by Task 2.

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
pub struct ResourceId(pub String);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    Global,
    Project,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Skill,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceMetadata {
    Skill,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: ResourceId,
    pub category: Category,
    pub scope: Scope,
    pub name: String,
    pub description: Option<String>,
    pub path: PathBuf,
    pub metadata: ResourceMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ResourceEvent {
    Added { resource: Resource },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEventBatch {
    pub events: Vec<ResourceEvent>,
    pub batch_id: u64,
    pub dropped_batches: u32,
}
