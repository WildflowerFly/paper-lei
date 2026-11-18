use std::collections::HashMap;
use uuid::Uuid;

#[derive(Default)]
pub struct ResourceTokens {
    entries: HashMap<Uuid, (Uuid, Vec<u8>)>,
}

impl ResourceTokens {
    pub fn issue(&mut self, document: Uuid, png: Vec<u8>) -> Option<Uuid> {
        if png.len() > 20 * 1024 * 1024 || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
            return None;
        }
        let token = Uuid::new_v4();
        self.entries.insert(token, (document, png));
        Some(token)
    }

    pub fn read(&self, document: Uuid, token: Uuid) -> Option<&[u8]> {
        self.entries
            .get(&token)
            .filter(|(owner, _)| *owner == document)
            .map(|(_, bytes)| bytes.as_slice())
    }

    pub fn revoke_document(&mut self, document: Uuid) {
        self.entries.retain(|_, (owner, _)| *owner != document);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_document_bound_revocable_and_do_not_accept_file_paths() {
        let mut resources = ResourceTokens::default();
        let document = Uuid::new_v4();
        let token = resources
            .issue(document, include_bytes!("../../icons/icon.png").to_vec())
            .unwrap();
        assert!(resources.read(Uuid::new_v4(), token).is_none());
        assert!(resources.read(document, Uuid::new_v4()).is_none());
        assert!(resources.read(document, token).is_some());
        assert!(
            resources
                .issue(document, b"C:\\secret.md".to_vec())
                .is_none()
        );
        resources.revoke_document(document);
        assert!(resources.read(document, token).is_none());
    }
}
